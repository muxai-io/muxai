import { spawn } from "child_process";
import { readFileSync } from "fs";
import path from "path";
import { prisma } from "../lib/db";
import { emitRunLog, emitRunDone, emitGlobalLog } from "./run-events";
import { INTERNAL_SECRET } from "./internal-secret";
import { dispatchNotifications, type NotificationChannel, type NotificationEvent } from "./notifications";

const CLAUDE_CLI = process.env.CLAUDE_CLI_PATH || "claude";
const MUXAI_ROOT = path.resolve(process.cwd(), "../..");
const REGISTRY_PATH = path.join(MUXAI_ROOT, "config/mcp-registry.json");

// Track active claude processes keyed by runId for cancellation
const activeProcesses = new Map<string, ReturnType<typeof spawn>>();

export function stopRun(runId: string): boolean {
  const child = activeProcesses.get(runId);
  if (!child) return false;
  child.kill("SIGTERM");
  return true;
}

async function buildBuiltinMcpConfig(excludeServers: string[] = []): Promise<string> {
  type McpEntry =
    | { command: string; args: string[] }
    | { type: "http"; url: string; headers?: Record<string, string> };

  const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as {
    id: string;
    type?: string;
    url?: string;
    command?: string;
    args?: string[];
  }[];
  // Check for globally disabled built-in servers
  const disabledSetting = await prisma.setting.findUnique({ where: { key: "mcp_disabled_servers" } });
  const disabled: string[] = disabledSetting?.value ? JSON.parse(disabledSetting.value) : [];
  const mcpServers: Record<string, McpEntry> = {};
  for (const server of registry) {
    if (disabled.includes(server.id) || excludeServers.includes(server.id)) continue;
    if (server.type === "http" && server.url) {
      mcpServers[server.id] = { type: "http", url: server.url };
    } else {
      mcpServers[server.id] = {
        command: server.command!,
        args: (server.args ?? []).map((a) => (path.isAbsolute(a) ? a : path.join(MUXAI_ROOT, a))),
      };
    }
  }
  // Merge custom DB servers
  const custom = await prisma.mcpServer.findMany();
  for (const server of custom) {
    const isHttp = server.command.startsWith("http://") || server.command.startsWith("https://");
    if (isHttp) {
      mcpServers[server.name] = {
        type: "http",
        url: server.command,
        ...(server.headers ? { headers: server.headers as Record<string, string> } : {}),
      };
    } else {
      mcpServers[server.name] = { command: server.command, args: server.args as string[] };
    }
  }
  return JSON.stringify({ mcpServers });
}

/**
 * Build the resolved invocation info for an agent without spawning it.
 * Returns the command, args (with large blobs replaced by placeholders),
 * env vars (MUXAI_* only), and supporting metadata for display/debugging.
 */
export async function buildInvokeInfo(agentId: string) {
  const agent = await prisma.agent.findUniqueOrThrow({
    where: { id: agentId },
    include: { reports: { select: { id: true, name: true, role: true, adapterConfig: true } } },
  });
  const config = agent.adapterConfig as Record<string, unknown>;

  const cwd = (config.cwd as string) || process.cwd();
  const model = (config.model as string) || "claude-sonnet-4-6";
  const maxTurns = (config.maxTurnsPerRun as number) || 10;
  const effort = config.effort as string | undefined;
  const disallowedTools = config.disallowedTools as string | undefined;
  const useChrome = Boolean(config.useChrome);
  const isBuiltin = cwd === MUXAI_ROOT;

  const baseSkillPrompt = config.promptTemplate as string | undefined;
  const reviewDecisions = Boolean(config.reviewDecisions);
  let skillPrompt = agent.reports.length > 0 ? buildSkillPromptWithTeam(baseSkillPrompt, agent.reports) : baseSkillPrompt;

  if (reviewDecisions) {
    const reviewBlock = `## Previous Decisions

Before producing a new result, call \`mcp__orchestrator__get_my_decisions\` to review your recent outputs. Use them as context to know what you decided before. If no previous decisions exist, proceed normally.`;
    skillPrompt = skillPrompt ? `${skillPrompt}\n\n${reviewBlock}` : reviewBlock;
  }

  const defaultPrompt = (config.defaultPrompt as string) || buildDefaultPrompt(agent);

  const infoMcpExclude = agent.reports.length > 0 ? [] : ["orchestrator"];
  const mcpConfig = isBuiltin ? JSON.parse(await buildBuiltinMcpConfig(infoMcpExclude)) : null;

  const args = [
    "--model",
    model,
    "--max-turns",
    String(maxTurns),
    "--dangerously-skip-permissions",
    ...(effort ? ["--effort", effort] : []),
    ...(useChrome ? ["--chrome"] : []),
    ...(isBuiltin ? ["--mcp-config", "<mcp-config>", "--strict-mcp-config"] : []),
    ...(disallowedTools ? ["--disallowedTools", disallowedTools] : []),
    ...(skillPrompt ? ["--system-prompt", "<system-prompt>"] : []),
    "--output-format",
    "stream-json",
    "--verbose",
    "--print",
    defaultPrompt,
  ];

  const env: Record<string, string> = {
    MUXAI_AGENT_ID: agent.id,
    MUXAI_AGENT_NAME: agent.name,
    MUXAI_AGENT_ROLE: agent.role,
    MUXAI_RUN_ID: "<generated-at-runtime>",
    MUXAI_API_URL: `http://localhost:${process.env.API_PORT || 3001}`,
    MUXAI_INTERNAL_SECRET: "<runtime-secret>",
    ...(agent.reports.length > 0
      ? {
          MUXAI_REPORTS: JSON.stringify(
            agent.reports.map((r) => ({
              id: r.id,
              name: r.name,
              role: r.role,
              skill: (r.adapterConfig as Record<string, unknown>)?.promptTemplate ?? "",
            })),
          ),
        }
      : {}),
  };

  return {
    command: CLAUDE_CLI,
    args,
    cwd,
    env,
    mcpMode: isBuiltin ? "builtin" : ("global" as "builtin" | "global"),
    mcpConfig,
    model,
    maxTurns,
    systemPrompt: skillPrompt ?? null,
    defaultPrompt,
  };
}

/**
 * Invoke an agent via the claude_local adapter.
 * Creates a WakeupRequest + HeartbeatRun, spawns the claude CLI,
 * streams stdout/stderr to the run log, then updates run status on exit.
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

  // Build env vars injected into the claude process
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    MUXAI_AGENT_ID: agent.id,
    MUXAI_AGENT_NAME: agent.name,
    MUXAI_AGENT_ROLE: agent.role,
    MUXAI_RUN_ID: run.id,
    MUXAI_API_URL: `http://localhost:${process.env.API_PORT || 3001}`,
    MUXAI_INTERNAL_SECRET: INTERNAL_SECRET,
    ...(agent.reports.length > 0 && {
      MUXAI_REPORTS: JSON.stringify(
        agent.reports.map((r) => ({
          id: r.id,
          name: r.name,
          role: r.role,
          skill: (r.adapterConfig as Record<string, unknown>)?.promptTemplate ?? "",
        })),
      ),
    }),
  };

  const cwd = (config.cwd as string) || process.cwd();
  const model = (config.model as string) || "claude-sonnet-4-6";
  const baseSkillPrompt = config.promptTemplate as string | undefined;
  const defaultPrompt = config.defaultPrompt as string | undefined;
  const maxTurns = (config.maxTurnsPerRun as number) || 10;
  const effort = config.effort as string | undefined;
  const disallowedTools = config.disallowedTools as string | undefined;
  const useChrome = Boolean(config.useChrome);
  const persistLogs = Boolean(config.persistLogs);
  const notifyOn = (config.notifyOn ?? []) as NotificationEvent[];
  const hasResultCard = !!(config.resultCard && (config.resultCard as Record<string, unknown>).type !== "none");
  const isBuiltin = cwd === MUXAI_ROOT;

  const reviewDecisions = Boolean(config.reviewDecisions);

  // If this agent has reporters, auto-inject team context so the model knows
  // about its team and the orchestrator tools — users shouldn't need to know
  // internal tool names.
  let skillPrompt = agent.reports.length > 0 ? buildSkillPromptWithTeam(baseSkillPrompt, agent.reports) : baseSkillPrompt;

  // If reviewDecisions is enabled, inject instruction to check past decisions first
  if (reviewDecisions) {
    const reviewBlock = `## Previous Decisions

Before producing a new result, call \`mcp__orchestrator__get_my_decisions\` to review your recent outputs. Use them as context to know what you decided before. If no previous decisions exist, proceed normally.`;
    skillPrompt = skillPrompt ? `${skillPrompt}\n\n${reviewBlock}` : reviewBlock;
  }

  const hasReports = agent.reports.length > 0;
  const mcpExclude = hasReports ? [] : ["orchestrator"];
  const mcpConfigJson = isBuiltin ? await buildBuiltinMcpConfig(mcpExclude) : null;

  const args = [
    "--model",
    model,
    "--max-turns",
    String(maxTurns),
    "--dangerously-skip-permissions",
    ...(effort ? ["--effort", effort] : []),
    ...(useChrome ? ["--chrome"] : []),
    ...(mcpConfigJson ? ["--mcp-config", mcpConfigJson, "--strict-mcp-config"] : []),
    ...(disallowedTools ? ["--disallowedTools", disallowedTools] : []),
    ...(skillPrompt ? ["--system-prompt", skillPrompt] : []),
    "--output-format",
    "stream-json",
    "--verbose",
    "--print",
    promptOverride || defaultPrompt || buildDefaultPrompt(agent),
  ];

  // Spawn the claude CLI process — fire and collect output
  spawnClaudeProcess({ run, agent, args, env, cwd, wakeupId: wakeup.id, agentName: agent.name, persistLogs, notifyOn, hasResultCard });

  return run;
}

function buildSkillPromptWithTeam(base: string | undefined, reports: { name: string; role: string; adapterConfig: unknown }[]): string {
  const roster = reports
    .map((r) => {
      const config = r.adapterConfig as Record<string, unknown> | null;
      const instructions = config?.defaultPrompt ? ` — ${config.defaultPrompt}` : "";
      return `- ${r.name} (role: ${r.role})${instructions}`;
    })
    .join("\n");
  const teamBlock = `## Your Team

You have direct reports. Use the orchestrator tools to coordinate them using their exact names, do not try to do their work yourself.

- Invoke all reporters in parallel: call \`mcp__orchestrator__run_team\`
- Invoke one reporter by name: call \`mcp__orchestrator__ask_reporter\` with \`{ "name": "<reporter name>" }\`

Your reporters:
${roster}`;

  return base ? `${base}\n\n${teamBlock}` : teamBlock;
}

function buildDefaultPrompt(agent: { name: string; role: string; capabilities?: string | null }) {
  return `You are ${agent.name}, a ${agent.role} agent.\n${agent.capabilities ? `Your capabilities: ${agent.capabilities}\n` : ""}Complete your assigned work and report the result.`;
}

/**
 * Extract the last valid JSON object or array from a log string.
 * Handles both raw JSON blocks and ```json fenced blocks.
 */
function extractLastJson(logs: string): unknown | null {
  // Try fenced blocks first (```json ... ```)
  const fenced = [...logs.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  for (let i = fenced.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(fenced[i][1].trim());
    } catch {
      /* continue */
    }
  }
  // Fall back: find all balanced JSON objects/arrays, try from last to first.
  // Properly tracks strings and escape sequences so braces inside strings
  // don't throw off the bracket matching (fixes cases where text follows JSON).
  const candidates: { start: number; end: number }[] = [];
  for (let i = 0; i < logs.length; i++) {
    if (logs[i] !== "{" && logs[i] !== "[") continue;
    const open = logs[i];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let j = i; j < logs.length; j++) {
      if (escape) {
        escape = false;
        continue;
      }
      if (logs[j] === "\\" && inString) {
        escape = true;
        continue;
      }
      if (logs[j] === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (logs[j] === open) depth++;
      else if (logs[j] === close) {
        if (--depth === 0) {
          candidates.push({ start: i, end: j });
          break;
        }
      }
    }
  }
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(logs.slice(candidates[i].start, candidates[i].end + 1));
    } catch {
      /* continue */
    }
  }
  return null;
}

function parseStreamJson(line: string): string | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;

    if (obj.type === "assistant") {
      const msg = obj.message as { content?: unknown[] } | undefined;
      const parts: string[] = [];
      for (const block of msg?.content ?? []) {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
          parts.push(b.text.trim());
        }
        if (b.type === "tool_use") {
          const input = b.input as Record<string, unknown> | undefined;
          const hint = input
            ? Object.entries(input)
                .slice(0, 2)
                .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 50)}`)
                .join(", ")
            : "";
          parts.push(`▶ ${b.name}${hint ? `(${hint})` : ""}`);
        }
      }
      return parts.length ? parts.join("\n") : null;
    }

    if (obj.type === "result") {
      const r = obj as { subtype?: string; result?: string; is_error?: boolean };
      if (r.is_error || r.subtype === "error") return `✗ ${r.result ?? "unknown error"}`;
      return null;
    }

    return null;
  } catch {
    return line.trim() || null;
  }
}

/** Returns only text content from assistant messages — excludes tool results and user turns. */
function extractAssistantText(line: string): string | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;
    if (obj.type !== "assistant") return null;
    const msg = obj.message as { content?: unknown[] } | undefined;
    const parts: string[] = [];
    for (const block of msg?.content ?? []) {
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
        parts.push(b.text.trim());
      }
    }
    return parts.length ? parts.join("\n") : null;
  } catch {
    return null;
  }
}

function spawnClaudeProcess(opts: {
  run: { id: string };
  agent: { id: string };
  agentName: string;
  persistLogs: boolean;
  notifyOn: NotificationEvent[];
  hasResultCard: boolean;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  wakeupId: string;
}) {
  const { run, agent, agentName, persistLogs, notifyOn, hasResultCard, args, env, cwd, wakeupId } = opts;
  const chunks: string[] = [];
  // Tracks only the lead agent's own assistant text — used for result extraction
  // so that reporter JSON returned via tool results doesn't get picked up instead.
  const assistantTextChunks: string[] = [];
  let stdoutBuffer = "";

  if (persistLogs) emitGlobalLog({ type: "run_start", agentId: agent.id, agentName, runId: run.id, ts: Date.now() });

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(CLAUDE_CLI, args, { cwd, env, shell: false });
  } catch (err: any) {
    const errorMsg = `Failed to spawn process: ${err.message}`;
    console.error(`[heartbeat] ${errorMsg}`);
    emitRunLog(run.id, errorMsg + "\n");
    emitRunDone(run.id, "failed", -1);
    if (persistLogs) emitGlobalLog({ type: "run_end", agentId: agent.id, agentName, runId: run.id, status: "failed", ts: Date.now() });
    prisma.heartbeatRun.update({ where: { id: run.id }, data: { status: "failed", finishedAt: new Date(), errorMsg, logs: errorMsg } }).catch(() => {});
    prisma.agent.update({ where: { id: agent.id }, data: { status: "error" } }).catch(() => {});
    prisma.wakeupRequest.update({ where: { id: wakeupId }, data: { status: "finished", finishedAt: new Date() } }).catch(() => {});
    return;
  }
  activeProcesses.set(run.id, child);

  child.stdout!.on("data", (data: Buffer) => {
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const text = parseStreamJson(line);
      if (!text) continue;
      chunks.push(text + "\n");
      emitRunLog(run.id, text + "\n");
      if (persistLogs) emitGlobalLog({ type: "log", agentId: agent.id, agentName, runId: run.id, data: text, ts: Date.now() });
      // Collect only the lead agent's assistant text for result extraction —
      // tool results (reporter payloads) come back as "user" type and are excluded.
      const assistantText = extractAssistantText(line);
      if (assistantText) assistantTextChunks.push(assistantText + "\n");
    }
  });

  child.stderr!.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      // Only surface orchestrator messages and actual warnings/errors — suppress Claude CLI debug noise
      if (line.includes("[orchestrator]") || /\b(warning|error|failed|fatal)\b/i.test(line)) {
        chunks.push(line + "\n");
        emitRunLog(run.id, line + "\n");
      }
    }
  });

  child.on("close", async (code) => {
    activeProcesses.delete(run.id);
    const logs = chunks.join("");
    const succeeded = code === 0;
    // Only extract resultJson if a result card is configured — agents with "No Result Card" skip this entirely
    const resultJson = hasResultCard ? (extractLastJson(assistantTextChunks.join("")) ?? extractLastJson(logs)) : null;

    if (persistLogs)
      emitGlobalLog({ type: "run_end", agentId: agent.id, agentName, runId: run.id, status: succeeded ? "succeeded" : "failed", ts: Date.now() });

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

    emitRunDone(run.id, succeeded ? "succeeded" : "failed", code ?? -1);

    // Fire notifications — fire-and-forget, never block run completion
    if (notifyOn.length > 0) {
      const base = { agentName, agentId: agent.id, runId: run.id };
      prisma.setting
        .findUnique({ where: { key: "notification_channels" } })
        .then((row) => {
          const channels: NotificationChannel[] = row ? JSON.parse(row.value) : [];
          console.log(
            `[notifications] agent=${agentName} notifyOn=${JSON.stringify(notifyOn)} channels=${channels.length} succeeded=${succeeded} hasResult=${resultJson !== null}`,
          );
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

    await prisma.agent.update({
      where: { id: agent.id },
      data: { status: succeeded ? "idle" : "error" },
    });

    await prisma.wakeupRequest.update({
      where: { id: wakeupId },
      data: { status: "finished", finishedAt: new Date() },
    });
  });

  child.on("error", async (err) => {
    activeProcesses.delete(run.id);
    const errorMsg = `Process error: ${err.message}`;
    console.error(`[heartbeat] ${errorMsg}`);
    emitRunLog(run.id, errorMsg + "\n");
    emitRunDone(run.id, "failed", -1);
    if (persistLogs) emitGlobalLog({ type: "run_end", agentId: agent.id, agentName, runId: run.id, status: "failed", ts: Date.now() });
    try {
      await prisma.heartbeatRun.update({
        where: { id: run.id },
        data: { status: "failed", finishedAt: new Date(), errorMsg, logs: chunks.join("") },
      });
      await prisma.agent.update({ where: { id: agent.id }, data: { status: "error" } });
      await prisma.wakeupRequest.update({ where: { id: wakeupId }, data: { status: "finished", finishedAt: new Date() } });
    } catch (dbErr: any) {
      console.error(`[heartbeat] DB cleanup failed after process error: ${dbErr.message}`);
    }
  });
}
