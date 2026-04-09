import { readFileSync } from "fs";
import path from "path";
import { prisma } from "../lib/db";

// ── Shared constants ────────────────────────────────────────────────
export const CLAUDE_CLI = process.env.CLAUDE_CLI_PATH || "claude";
export const MUXAI_ROOT = path.resolve(process.cwd(), "../..");
export const REGISTRY_PATH = path.join(MUXAI_ROOT, "config/mcp-registry.json");

// ── MCP config builder ──────────────────────────────────────────────

type McpEntry =
  | { command: string; args: string[] }
  | { type: "http"; url: string; headers?: Record<string, string> };

/**
 * Build the MCP config JSON string from the registry + custom DB servers.
 * @param excludeServers - server IDs to exclude (e.g. "orchestrator" for non-lead agents)
 */
export async function buildMcpConfig(excludeServers: string[] = []): Promise<string> {
  let registry: { id: string; type?: string; url?: string; command?: string; args?: string[] }[];
  try {
    registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
  } catch (err: any) {
    console.error(`[mcp-config] Failed to read registry at ${REGISTRY_PATH}: ${err.message}`);
    registry = [];
  }

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

// ── Shared helpers ──────────────────────────────────────────────────

export function buildDefaultPrompt(agent: { name: string; role: string; capabilities?: string | null }): string {
  return `You are ${agent.name}, a ${agent.role} agent.\n${agent.capabilities ? `Your capabilities: ${agent.capabilities}\n` : ""}Complete your assigned work and report the result.`;
}
