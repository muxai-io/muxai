import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildDefaultPrompt } from "../claude-spawn";

// ── buildDefaultPrompt (pure, no mocks needed) ─��───────────────────

describe("buildDefaultPrompt", () => {
  it("builds prompt with name and role", () => {
    const result = buildDefaultPrompt({ name: "News Bot", role: "analyst" });
    expect(result).toContain("News Bot");
    expect(result).toContain("analyst");
    expect(result).toContain("Complete your assigned work");
  });

  it("includes capabilities when provided", () => {
    const result = buildDefaultPrompt({
      name: "Trader",
      role: "lead",
      capabilities: "BTC analysis, risk management",
    });
    expect(result).toContain("BTC analysis, risk management");
  });

  it("omits capabilities line when null", () => {
    const result = buildDefaultPrompt({ name: "Bot", role: "general", capabilities: null });
    expect(result).not.toContain("capabilities");
  });
});

// ── buildMcpConfig (requires mocking prisma + fs) ───────────────────

// Mock prisma before importing buildMcpConfig
vi.mock("../../lib/db", () => ({
  prisma: {
    setting: {
      findUnique: vi.fn(),
    },
    mcpServer: {
      findMany: vi.fn(),
    },
  },
}));

// Mock fs.readFileSync
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(),
  };
});

import { buildMcpConfig } from "../claude-spawn";
import { prisma } from "../../lib/db";
import { readFileSync } from "fs";

const mockReadFileSync = vi.mocked(readFileSync);
const mockSettingFindUnique = vi.mocked(prisma.setting.findUnique);
const mockMcpServerFindMany = vi.mocked(prisma.mcpServer.findMany);

describe("buildMcpConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingFindUnique.mockResolvedValue(null);
    mockMcpServerFindMany.mockResolvedValue([]);
  });

  it("parses registry and returns mcpServers JSON", async () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify([
        { id: "news", command: "node", args: ["news.js"] },
        { id: "chart", type: "http", url: "http://localhost:4000" },
      ]),
    );

    const result = JSON.parse(await buildMcpConfig());

    expect(result.mcpServers.news).toEqual({
      command: "node",
      args: [expect.stringContaining("news.js")],
    });
    expect(result.mcpServers.chart).toEqual({
      type: "http",
      url: "http://localhost:4000",
    });
  });

  it("excludes servers in excludeServers param", async () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify([
        { id: "orchestrator", command: "node", args: ["orch.js"] },
        { id: "news", command: "node", args: ["news.js"] },
      ]),
    );

    const result = JSON.parse(await buildMcpConfig(["orchestrator"]));

    expect(result.mcpServers.orchestrator).toBeUndefined();
    expect(result.mcpServers.news).toBeDefined();
  });

  it("excludes globally disabled servers", async () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify([
        { id: "wallet", command: "node", args: ["wallet.js"] },
        { id: "docs", command: "node", args: ["docs.js"] },
      ]),
    );
    mockSettingFindUnique.mockResolvedValue({ key: "mcp_disabled_servers", value: '["docs"]' } as any);

    const result = JSON.parse(await buildMcpConfig());

    expect(result.mcpServers.wallet).toBeDefined();
    expect(result.mcpServers.docs).toBeUndefined();
  });

  it("merges custom DB servers", async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify([]));
    mockMcpServerFindMany.mockResolvedValue([
      { name: "custom-stdio", command: "python", args: ["serve.py"] as any, headers: null } as any,
      { name: "custom-http", command: "https://api.example.com/mcp", args: [] as any, headers: { Authorization: "Bearer xyz" } } as any,
    ]);

    const result = JSON.parse(await buildMcpConfig());

    expect(result.mcpServers["custom-stdio"]).toEqual({
      command: "python",
      args: ["serve.py"],
    });
    expect(result.mcpServers["custom-http"]).toEqual({
      type: "http",
      url: "https://api.example.com/mcp",
      headers: { Authorization: "Bearer xyz" },
    });
  });

  it("handles readFileSync failure gracefully", async () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT: file not found");
    });

    // Should not throw — returns empty registry, just custom servers
    const result = JSON.parse(await buildMcpConfig());
    expect(result.mcpServers).toEqual({});
  });

  it("returns empty when registry empty and no custom servers", async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify([]));

    const result = JSON.parse(await buildMcpConfig());
    expect(result.mcpServers).toEqual({});
  });
});
