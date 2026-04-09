import { prisma } from "../lib/db";
import { emitRunLog, emitRunDone, emitGlobalLog } from "./run-events";
import { dispatchNotifications, type NotificationChannel, type NotificationEvent } from "./notifications";
import { getAdapter } from "./adapters";
import type { AdapterAgent } from "./adapters";
import { MUXAI_ROOT, buildMcpConfig, buildDefaultPrompt } from "./claude-spawn";
import { parseStreamJson, extractAssistantText, extractLastJson } from "./stream-parser";
import { trackProcess, untrackProcess, stopProcess } from "./process-manager";

// ── Stop ────────────────────────────────────────────────────────────

export function stopRun(runId: string): boolean {
  return stopProcess(runId);
}

// ── Invoke info (preview) ───────────────────────────────────────────

/**
 * Build the resolved invocation info for an agent without spawning it.
 * Returns the command, args, env vars, and metadata for display/debugging.
 */
export async function buildInvokeInfo(agentId: string) {
  const agent = await prisma.agent.findUniqueOrThrow({
    where: { id: agentId },
    include: { reports: { select: { id: true, name: true, role: true, adapterConfig: true } } },
  });

  const adapterAgent: AdapterAgent = {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    capabilities: agent.capabilities,
    adapterConfig: agent.adapterConfig as Record<string, unknown>,
    reports: agent.reports.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      adapterConfig: r.adapterConfig,
    })),
  };

  const adapter = getAdapter(agent.adapterType);
  const spawnConfig = await adapter.buildSpawnConfig(adapterAgent, { isPreview: true });

  const config = agent.adapterConfig as Record<string, unknown>;
  const cwd = (config.cwd as string) || process.cwd();
  const isBuiltin = cwd === MUXAI_ROOT;
  const mcpExclude = agent.reports.length > 0 ? [] : ["orchestrator"];
  const mcpConfig = isBuiltin ? JSON.parse(await buildMcpConfig(mcpExclude)) : null;

  // Filter env to only MUXAI_* vars for preview
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(spawnConfig.env)) {
    if (k.startsWith("MUXAI_")) env[k] = v;
  }

  return {
    command: spawnConfig.command,
    args: spawnConfig.args,
    cwd: spawnConfig.cwd,
    env,
    mcpMode: isBuiltin ? "builtin" : ("global" as "builtin" | "global"),
    mcpConfig,
    model: (config.model as string) || "claude-sonnet-4-6",
    maxTurns: (config.maxTurnsPerRun as number) || 10,
    systemPrompt: (config.promptTemplate as string) ?? null,
    defaultPrompt: (config.defaultPrompt as string) || buildDefaultPrompt(agent),
  };
}

// ── Invoke ──────────────────────────────────────────────────────────

/**
 * Invoke an agent. Creates DB records, delegates to the adapter for
 * spawning, then wires up stream parsing, logging, and notifications.
 */
export async function invokeAgent(agentId: string, promptOverride?: string) {
  const agent = await prisma.agent.findUniqueOrThrow({
    where: { id: agentId },
    include: { reports: { select: { id: true, name: true, role: true, adapterConfig: true } } },
  });
  const config = agent.adapterConfig as Record<string, unknown>;

  // Create wakeup + run records
  const wakeup = await prisma.wakeupRequest.create({
    data: { agentId, source: "on_demand", reason: "manual invoke", status: "claimed", claimedAt: new Date() },
  });

  const run = await prisma.heartbeatRun.create({
    data: {
      agentId,
      status: "running",
      invocationSource: "on_demand",
      startedAt: new Date(),
      wakeupRequestId: wakeup.id,
    },
  });

  // Mark agent as running
  await prisma.agent.update({ where: { id: agentId }, data: { status: "running" } });

  const adapterAgent: AdapterAgent = {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    capabilities: agent.capabilities,
    adapterConfig: config,
    reports: agent.reports.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      adapterConfig: r.adapterConfig,
    })),
  };

  const persistLogs = Boolean(config.persistLogs);
  const notifyOn = (config.notifyOn ?? []) as NotificationEvent[];
  const hasResultCard = !!(config.resultCard && (config.resultCard as Record<string, unknown>).type !== "none");

  // Build spawn config via adapter
  const adapter = getAdapter(agent.adapterType);
  let spawnConfig;
  try {
    spawnConfig = await adapter.buildSpawnConfig(adapterAgent, { promptOverride, runId: run.id });
  } catch (err: any) {
    const errorMsg = `Failed to build spawn config: ${err.message}`;
    console.error(`[heartbeat] ${errorMsg}`);
    await handleSpawnFailure(run.id, agent.id, agent.name, wakeup.id, persistLogs, errorMsg);
    return run;
  }

  // Spawn via adapter with callbacks
  const chunks: string[] = [];
  const assistantTextChunks: string[] = [];

  if (persistLogs) emitGlobalLog({ type: "run_start", agentId: agent.id, agentName: agent.name, runId: run.id, ts: Date.now() });

  let child;
  try {
    child = adapter.spawn(spawnConfig, {
      onStdoutLine(line: string) {
        const { text } = parseStreamJson(line);
        if (!text) return;
        chunks.push(text + "\n");
        emitRunLog(run.id, text + "\n");
        if (persistLogs) emitGlobalLog({ type: "log", agentId: agent.id, agentName: agent.name, runId: run.id, data: text, ts: Date.now() });
        const assistantText = extractAssistantText(line);
        if (assistantText) assistantTextChunks.push(assistantText + "\n");
      },

      onStderrLine(line: string) {
        if (line.includes("[orchestrator]") || /\b(warning|error|failed|fatal)\b/i.test(line)) {
          chunks.push(line + "\n");
          emitRunLog(run.id, line + "\n");
        }
      },

      async onClose(code: number | null) {
        untrackProcess(run.id);
        const logs = chunks.join("");
        const succeeded = code === 0;
        const resultJson = hasResultCard ? (extractLastJson(assistantTextChunks.join("")) ?? extractLastJson(logs)) : null;

        if (persistLogs)
          emitGlobalLog({ type: "run_end", agentId: agent.id, agentName: agent.name, runId: run.id, status: succeeded ? "succeeded" : "failed", ts: Date.now() });

        try {
          await prisma.heartbeatRun.update({
            where: { id: run.id },
            data: {
              status: succeeded ? "succeeded" : "failed",
              exitCode: code ?? -1,
              finishedAt: new Date(),
              logs,
              errorMsg: succeeded ? null : `Process exited with code ${code}`,
              ...(resultJson !== null ? { resultJson: resultJson as any } : {}),
            },
          });
        } catch (dbErr: any) {
          console.error(`[heartbeat] DB update failed on close: ${dbErr.message}`);
        }

        emitRunDone(run.id, succeeded ? "succeeded" : "failed", code ?? -1);

        // Fire notifications
        if (notifyOn.length > 0) {
          const base = { agentName: agent.name, agentId: agent.id, runId: run.id };
          prisma.setting
            .findUnique({ where: { key: "notification_channels" } })
            .then((row) => {
              const channels: NotificationChannel[] = row ? JSON.parse(row.value) : [];
              if (!succeeded) {
                dispatchNotifications(channels, notifyOn, { ...base, event: "error", errorMsg: `Process exited with code ${code}`, exitCode: code ?? -1 });
              } else {
                if (resultJson) {
                  dispatchNotifications(channels, notifyOn, { ...base, event: "decision", resultJson: resultJson as Record<string, unknown> });
                }
                dispatchNotifications(channels, notifyOn, { ...base, event: "run_end" });
              }
            })
            .catch((err) => {
              console.error("[notifications] dispatch setup failed:", err.message);
            });
        }

        try {
          await prisma.agent.update({ where: { id: agent.id }, data: { status: succeeded ? "idle" : "error" } });
          await prisma.wakeupRequest.update({ where: { id: wakeup.id }, data: { status: "finished", finishedAt: new Date() } });
        } catch (dbErr: any) {
          console.error(`[heartbeat] DB cleanup failed on close: ${dbErr.message}`);
        }
      },

      async onError(err: Error) {
        untrackProcess(run.id);
        const errorMsg = `Process error: ${err.message}`;
        console.error(`[heartbeat] ${errorMsg}`);
        emitRunLog(run.id, errorMsg + "\n");
        emitRunDone(run.id, "failed", -1);
        if (persistLogs) emitGlobalLog({ type: "run_end", agentId: agent.id, agentName: agent.name, runId: run.id, status: "failed", ts: Date.now() });
        try {
          await prisma.heartbeatRun.update({
            where: { id: run.id },
            data: { status: "failed", finishedAt: new Date(), errorMsg, logs: chunks.join("") },
          });
          await prisma.agent.update({ where: { id: agent.id }, data: { status: "error" } });
          await prisma.wakeupRequest.update({ where: { id: wakeup.id }, data: { status: "finished", finishedAt: new Date() } });
        } catch (dbErr: any) {
          console.error(`[heartbeat] DB cleanup failed after process error: ${dbErr.message}`);
        }
      },
    });
  } catch (err: any) {
    const errorMsg = `Failed to spawn process: ${err.message}`;
    console.error(`[heartbeat] ${errorMsg}`);
    await handleSpawnFailure(run.id, agent.id, agent.name, wakeup.id, persistLogs, errorMsg);
    return run;
  }

  trackProcess(run.id, child);
  return run;
}

// ── Helpers ─────────────────────────────────────────────────────────

async function handleSpawnFailure(runId: string, agentId: string, agentName: string, wakeupId: string, persistLogs: boolean, errorMsg: string) {
  emitRunLog(runId, errorMsg + "\n");
  emitRunDone(runId, "failed", -1);
  if (persistLogs) emitGlobalLog({ type: "run_end", agentId, agentName, runId, status: "failed", ts: Date.now() });
  prisma.heartbeatRun.update({ where: { id: runId }, data: { status: "failed", finishedAt: new Date(), errorMsg, logs: errorMsg } }).catch(() => {});
  prisma.agent.update({ where: { id: agentId }, data: { status: "error" } }).catch(() => {});
  prisma.wakeupRequest.update({ where: { id: wakeupId }, data: { status: "finished", finishedAt: new Date() } }).catch(() => {});
}
