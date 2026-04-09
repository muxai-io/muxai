import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";
import { readFileSync } from "fs";

const MUXAI_ROOT = path.resolve(__dirname, "../../../../..");
const REGISTRY_PATH = path.join(MUXAI_ROOT, "config/mcp-registry.json");

// Load registry to get expected tools per server
const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as {
  id: string;
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
  tools: { name: string }[];
}[];

// Only test stdio servers (skip HTTP like docs)
const stdioServers = registry.filter((s) => !s.type || s.type !== "http");

/**
 * Spawn an MCP server, connect as a client, call tools/list, then disconnect.
 */
async function connectAndListTools(server: (typeof stdioServers)[0]) {
  const command = server.command!;
  const args = (server.args ?? []).map((a) => (path.isAbsolute(a) ? a : path.join(MUXAI_ROOT, a)));

  const transport = new StdioClientTransport({ command, args, cwd: MUXAI_ROOT });
  const client = new Client({ name: "test-client", version: "1.0.0" });

  await client.connect(transport);
  const result = await client.listTools();
  await client.close();

  return result.tools;
}

describe("MCP server connections", () => {
  for (const server of stdioServers) {
    describe(server.id, () => {
      it("connects and lists tools", async () => {
        const tools = await connectAndListTools(server);
        expect(tools.length).toBeGreaterThan(0);
      });

      it("exposes expected tools", async () => {
        const tools = await connectAndListTools(server);
        const toolNames = tools.map((t) => t.name);

        for (const expected of server.tools) {
          expect(toolNames, `Missing tool: ${expected.name}`).toContain(expected.name);
        }
      });
    });
  }
});
