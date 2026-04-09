import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import { CLAUDE_CLI, MUXAI_ROOT, buildMcpConfig, buildDefaultPrompt } from "../claude-spawn";
import { INTERNAL_SECRET } from "../internal-secret";
import type { Adapter, AdapterAgent, SpawnConfig, SpawnCallbacks } from "./types";
import { registerAdapter } from "./types";

// ── Helpers ─────────────────────────────────────────────────────────

function buildSkillPromptWithTeam(
  base: string | undefined,
  reports: { name: string; role: string; adapterConfig: unknown }[],
): string {
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

// ── ClaudeLocal adapter ─────────────────────────────────────────────

export const claudeLocalAdapter: Adapter = {
  type: "claude_local",

  async buildSpawnConfig(agent: AdapterAgent, opts): Promise<SpawnConfig> {
    const config = agent.adapterConfig;
    const { promptOverride, runId, isPreview } = opts;

    const cwd = (config.cwd as string) || process.cwd();
    const model = (config.model as string) || "claude-sonnet-4-6";
    const maxTurns = (config.maxTurnsPerRun as number) || 10;
    const effort = config.effort as string | undefined;
    const disallowedTools = config.disallowedTools as string | undefined;
    const useChrome = Boolean(config.useChrome);
    const isBuiltin = cwd === MUXAI_ROOT;

    // Build system prompt with team context if agent has reporters
    const baseSkillPrompt = config.promptTemplate as string | undefined;
    const reviewDecisions = Boolean(config.reviewDecisions);
    let skillPrompt =
      agent.reports.length > 0 ? buildSkillPromptWithTeam(baseSkillPrompt, agent.reports) : baseSkillPrompt;

    if (reviewDecisions) {
      const reviewBlock = `## Previous Decisions

Before producing a new result, call \`mcp__orchestrator__get_my_decisions\` to review your recent outputs. Use them as context to know what you decided before. If no previous decisions exist, proceed normally.`;
      skillPrompt = skillPrompt ? `${skillPrompt}\n\n${reviewBlock}` : reviewBlock;
    }

    const defaultPrompt = (config.defaultPrompt as string) || buildDefaultPrompt(agent);

    // MCP config — exclude orchestrator for agents without reports
    const mcpExclude = agent.reports.length > 0 ? [] : ["orchestrator"];
    let mcpConfigJson: string | null = null;
    if (isBuiltin) {
      mcpConfigJson = await buildMcpConfig(mcpExclude);
    }

    const args = [
      "--model", model,
      "--max-turns", String(maxTurns),
      "--dangerously-skip-permissions",
      ...(effort ? ["--effort", effort] : []),
      ...(useChrome ? ["--chrome"] : []),
      ...(mcpConfigJson
        ? ["--mcp-config", isPreview ? "<mcp-config>" : mcpConfigJson, "--strict-mcp-config"]
        : []),
      ...(disallowedTools ? ["--disallowedTools", disallowedTools] : []),
      ...(skillPrompt ? ["--system-prompt", isPreview ? "<system-prompt>" : skillPrompt] : []),
      "--output-format", "stream-json",
      "--verbose",
      "--print", promptOverride || defaultPrompt,
    ];

    // Build env vars
    const env: Record<string, string> = {
      ...(isPreview ? {} : (process.env as Record<string, string>)),
      MUXAI_AGENT_ID: agent.id,
      MUXAI_AGENT_NAME: agent.name,
      MUXAI_AGENT_ROLE: agent.role,
      MUXAI_RUN_ID: runId || "<generated-at-runtime>",
      MUXAI_API_URL: `http://localhost:${process.env.API_PORT || 3001}`,
      MUXAI_INTERNAL_SECRET: isPreview ? "<runtime-secret>" : INTERNAL_SECRET,
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

    return { command: CLAUDE_CLI, args, cwd, env };
  },

  spawn(config: SpawnConfig, callbacks: SpawnCallbacks): ChildProcess {
    const child = spawn(config.command, config.args, {
      cwd: config.cwd,
      env: config.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdoutBuffer = "";
    child.stdout!.on("data", (data: Buffer) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) callbacks.onStdoutLine(line);
      }
    });

    child.stderr!.on("data", (data: Buffer) => {
      for (const line of data.toString().split("\n")) {
        if (line.trim()) callbacks.onStderrLine(line);
      }
    });

    child.on("close", (code) => callbacks.onClose(code));
    child.on("error", (err) => callbacks.onError(err));

    return child;
  },
};

// Auto-register on import
registerAdapter(claudeLocalAdapter);
