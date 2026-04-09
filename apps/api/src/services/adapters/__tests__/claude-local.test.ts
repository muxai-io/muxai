import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AdapterAgent } from "../types";

// Mock dependencies before importing the adapter
vi.mock("../../claude-spawn", () => ({
  CLAUDE_CLI: "claude",
  MUXAI_ROOT: "/mock/muxai-root",
  buildMcpConfig: vi.fn().mockResolvedValue('{"mcpServers":{}}'),
  buildDefaultPrompt: vi.fn().mockReturnValue("You are TestBot, a general agent."),
}));

vi.mock("../../internal-secret", () => ({
  INTERNAL_SECRET: "mock-secret-123",
}));

import { claudeLocalAdapter } from "../claude-local";
import { buildMcpConfig } from "../../claude-spawn";

const mockBuildMcpConfig = vi.mocked(buildMcpConfig);

function makeAgent(overrides: Partial<AdapterAgent> = {}): AdapterAgent {
  return {
    id: "agent-1",
    name: "TestBot",
    role: "general",
    capabilities: null,
    adapterConfig: {
      model: "claude-sonnet-4-6",
      maxTurnsPerRun: 10,
      cwd: "/mock/muxai-root",
      defaultPrompt: "Do the thing",
      persistLogs: true,
    },
    reports: [],
    ...overrides,
  };
}

describe("claudeLocalAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildMcpConfig.mockResolvedValue('{"mcpServers":{}}');
  });

  it("has type claude_local", () => {
    expect(claudeLocalAdapter.type).toBe("claude_local");
  });

  describe("buildSpawnConfig", () => {
    it("builds basic args", async () => {
      const config = await claudeLocalAdapter.buildSpawnConfig(makeAgent(), {});
      expect(config.command).toBe("claude");
      expect(config.args).toContain("--model");
      expect(config.args).toContain("claude-sonnet-4-6");
      expect(config.args).toContain("--max-turns");
      expect(config.args).toContain("10");
      expect(config.args).toContain("--dangerously-skip-permissions");
      expect(config.args).toContain("--output-format");
      expect(config.args).toContain("stream-json");
      expect(config.args).toContain("--verbose");
      expect(config.args).toContain("--print");
    });

    it("uses promptOverride over defaultPrompt", async () => {
      const config = await claudeLocalAdapter.buildSpawnConfig(makeAgent(), {
        promptOverride: "Custom task",
      });
      expect(config.args[config.args.indexOf("--print") + 1]).toBe("Custom task");
    });

    it("uses defaultPrompt when no override", async () => {
      const config = await claudeLocalAdapter.buildSpawnConfig(makeAgent(), {});
      expect(config.args[config.args.indexOf("--print") + 1]).toBe("Do the thing");
    });

    it("includes effort flag when set", async () => {
      const agent = makeAgent({
        adapterConfig: { ...makeAgent().adapterConfig, effort: "high" },
      });
      const config = await claudeLocalAdapter.buildSpawnConfig(agent, {});
      const idx = config.args.indexOf("--effort");
      expect(idx).toBeGreaterThan(-1);
      expect(config.args[idx + 1]).toBe("high");
    });

    it("excludes effort flag when not set", async () => {
      const config = await claudeLocalAdapter.buildSpawnConfig(makeAgent(), {});
      expect(config.args).not.toContain("--effort");
    });

    it("includes --chrome when useChrome is true", async () => {
      const agent = makeAgent({
        adapterConfig: { ...makeAgent().adapterConfig, useChrome: true },
      });
      const config = await claudeLocalAdapter.buildSpawnConfig(agent, {});
      expect(config.args).toContain("--chrome");
    });

    it("excludes --chrome when useChrome is false", async () => {
      const config = await claudeLocalAdapter.buildSpawnConfig(makeAgent(), {});
      expect(config.args).not.toContain("--chrome");
    });

    it("includes disallowedTools when set", async () => {
      const agent = makeAgent({
        adapterConfig: { ...makeAgent().adapterConfig, disallowedTools: "Bash,Write" },
      });
      const config = await claudeLocalAdapter.buildSpawnConfig(agent, {});
      const idx = config.args.indexOf("--disallowedTools");
      expect(idx).toBeGreaterThan(-1);
      expect(config.args[idx + 1]).toBe("Bash,Write");
    });

    it("includes MCP config for builtin cwd", async () => {
      const config = await claudeLocalAdapter.buildSpawnConfig(makeAgent(), {});
      expect(config.args).toContain("--mcp-config");
      expect(config.args).toContain("--strict-mcp-config");
      expect(mockBuildMcpConfig).toHaveBeenCalledWith(["orchestrator"]);
    });

    it("excludes orchestrator from MCP for agents without reports", async () => {
      await claudeLocalAdapter.buildSpawnConfig(makeAgent(), {});
      expect(mockBuildMcpConfig).toHaveBeenCalledWith(["orchestrator"]);
    });

    it("includes orchestrator in MCP for agents with reports", async () => {
      const agent = makeAgent({
        reports: [
          { id: "r1", name: "News Analyst", role: "reporter", adapterConfig: {} },
        ],
      });
      await claudeLocalAdapter.buildSpawnConfig(agent, {});
      expect(mockBuildMcpConfig).toHaveBeenCalledWith([]);
    });

    it("skips MCP config for non-builtin cwd", async () => {
      const agent = makeAgent({
        adapterConfig: { ...makeAgent().adapterConfig, cwd: "/some/other/path" },
      });
      const config = await claudeLocalAdapter.buildSpawnConfig(agent, {});
      expect(config.args).not.toContain("--mcp-config");
      expect(mockBuildMcpConfig).not.toHaveBeenCalled();
    });

    it("uses placeholder in preview mode", async () => {
      const agent = makeAgent({
        adapterConfig: { ...makeAgent().adapterConfig, promptTemplate: "You are a bot" },
      });
      const config = await claudeLocalAdapter.buildSpawnConfig(agent, { isPreview: true });
      expect(config.args).toContain("<mcp-config>");
      expect(config.args).toContain("<system-prompt>");
    });

    it("injects team context for agents with reports", async () => {
      const agent = makeAgent({
        adapterConfig: { ...makeAgent().adapterConfig, promptTemplate: "Base prompt" },
        reports: [
          { id: "r1", name: "News Analyst", role: "reporter", adapterConfig: { defaultPrompt: "Fetch news" } },
        ],
      });
      const config = await claudeLocalAdapter.buildSpawnConfig(agent, {});
      const sysIdx = config.args.indexOf("--system-prompt");
      const systemPrompt = config.args[sysIdx + 1];
      expect(systemPrompt).toContain("Your Team");
      expect(systemPrompt).toContain("News Analyst");
      expect(systemPrompt).toContain("mcp__orchestrator__run_team");
    });

    it("injects reviewDecisions block", async () => {
      const agent = makeAgent({
        adapterConfig: { ...makeAgent().adapterConfig, reviewDecisions: true, promptTemplate: "Base" },
      });
      const config = await claudeLocalAdapter.buildSpawnConfig(agent, {});
      const sysIdx = config.args.indexOf("--system-prompt");
      const systemPrompt = config.args[sysIdx + 1];
      expect(systemPrompt).toContain("get_my_decisions");
    });

    // ── Env vars ──

    it("injects MUXAI env vars", async () => {
      const config = await claudeLocalAdapter.buildSpawnConfig(makeAgent(), { runId: "run-42" });
      expect(config.env.MUXAI_AGENT_ID).toBe("agent-1");
      expect(config.env.MUXAI_AGENT_NAME).toBe("TestBot");
      expect(config.env.MUXAI_AGENT_ROLE).toBe("general");
      expect(config.env.MUXAI_RUN_ID).toBe("run-42");
      expect(config.env.MUXAI_INTERNAL_SECRET).toBe("mock-secret-123");
    });

    it("injects MUXAI_REPORTS for lead agents", async () => {
      const agent = makeAgent({
        reports: [
          { id: "r1", name: "Reporter A", role: "analyst", adapterConfig: { promptTemplate: "skill A" } },
        ],
      });
      const config = await claudeLocalAdapter.buildSpawnConfig(agent, {});
      const reports = JSON.parse(config.env.MUXAI_REPORTS);
      expect(reports).toHaveLength(1);
      expect(reports[0].name).toBe("Reporter A");
      expect(reports[0].skill).toBe("skill A");
    });

    it("omits MUXAI_REPORTS for agents without reports", async () => {
      const config = await claudeLocalAdapter.buildSpawnConfig(makeAgent(), {});
      expect(config.env.MUXAI_REPORTS).toBeUndefined();
    });

    it("uses placeholder env in preview mode", async () => {
      const config = await claudeLocalAdapter.buildSpawnConfig(makeAgent(), { isPreview: true });
      expect(config.env.MUXAI_RUN_ID).toBe("<generated-at-runtime>");
      expect(config.env.MUXAI_INTERNAL_SECRET).toBe("<runtime-secret>");
      // Should NOT include process.env in preview
      expect(config.env.PATH).toBeUndefined();
    });
  });
});
