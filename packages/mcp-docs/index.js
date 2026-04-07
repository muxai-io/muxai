#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const MINTLIFY_BASE = "https://muxaiio.mintlify.app";
const MCP_URL = `${MINTLIFY_BASE}/mcp`;

async function mintlifyRequest(method, params = {}) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Mintlify API error: ${res.status} ${res.statusText}`);

  const contentType = res.headers.get("content-type") || "";

  // If server returns SSE, parse the stream for the JSON-RPC response
  if (contentType.includes("text/event-stream")) {
    const text = await res.text();
    for (const line of text.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          const json = JSON.parse(line.slice(6));
          if (json.error) throw new Error(json.error.message || "Mintlify MCP error");
          return json.result;
        } catch (e) {
          if (e.message?.includes("Mintlify")) throw e;
          // not a valid JSON line, continue
        }
      }
    }
    throw new Error("No valid JSON-RPC response in SSE stream");
  }

  // Otherwise parse as plain JSON
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "Mintlify MCP error");
  return json.result;
}

// --- MCP server ---

const server = new Server(
  { name: "docs", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_docs",
      description:
        "Search the muxai platform documentation. Returns matching pages with titles, paths, and snippets. " +
        "Use this to find information about agent configuration, orchestration, MCP servers, trade decision formats, and more.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query (e.g. 'trade decision format', 'orchestration', 'MCP servers')",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_doc_page",
      description:
        "Retrieve the full content of a muxai documentation page by its path. " +
        "Use search_docs first to find the right path, then fetch the full page.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Page path from search results (e.g. '/core-concepts/agents')",
          },
        },
        required: ["path"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "search_docs") {
      const result = await mintlifyRequest("tools/call", {
        name: "search_mux_ai",
        arguments: { query: args.query },
      });
      const text = result?.content?.[0]?.text ?? JSON.stringify(result);
      return { content: [{ type: "text", text }] };
    }

    if (name === "get_doc_page") {
      const result = await mintlifyRequest("tools/call", {
        name: "get_page_mux_ai",
        arguments: { path: args.path },
      });
      const text = result?.content?.[0]?.text ?? JSON.stringify(result);
      return { content: [{ type: "text", text }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
