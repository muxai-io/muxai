#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "contractor", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

function getApiUrl() {
  return process.env.MUXAI_API_URL || "http://localhost:3001";
}

function internalHeaders() {
  const secret = process.env.MUXAI_INTERNAL_SECRET;
  return secret ? { "x-muxai-internal": secret } : {};
}

function log(msg) {
  process.stderr.write(`[contractor] ${msg}\n`);
}

async function fetchContractor(name) {
  const res = await fetch(`${getApiUrl()}/api/contractors/${encodeURIComponent(name)}`, {
    headers: internalHeaders(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch contractor: ${res.status}`);
  return res.json();
}

async function fetchAllContractors() {
  const res = await fetch(`${getApiUrl()}/api/contractors`, {
    headers: internalHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to fetch contractors: ${res.status}`);
  return res.json();
}

async function callContractor(contractor, prompt) {
  const res = await fetch(`${contractor.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${contractor.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://muxai.io",
      "X-Title": "muxai",
    },
    body: JSON.stringify({
      model: contractor.model,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Contractor API error ${res.status}: ${body}`);
  }
  let data;
  try { data = await res.json(); } catch { throw new Error(`Contractor API returned invalid JSON`); }
  return data.choices?.[0]?.message?.content ?? "(no response)";
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "ask_contractor",
      description: "Send a prompt to a hired contractor model (e.g. Grok, GPT-4o) and get their response. Check the contract is active first — inactive contracts will be rejected.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "The contractor's name as registered in the platform (case-sensitive)" },
          prompt: { type: "string", description: "The message/question to send to the contractor" },
        },
        required: ["name", "prompt"],
      },
    },
    {
      name: "list_contractors",
      description: "List all available contractors and their status. Use this to discover which contractors are under active agreement before calling ask_contractor.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "list_contractors") {
    const contractors = await fetchAllContractors();
    if (contractors.length === 0) {
      return { content: [{ type: "text", text: "No contractors registered." }] };
    }
    const lines = contractors.map((c) =>
      `• ${c.name} — ${c.model} (${c.provider}) — Contract: ${c.status.toUpperCase()}${c.description ? ` — ${c.description}` : ""}`
    );
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  if (name === "ask_contractor") {
    const { name: contractorName, prompt } = args;
    log(`Looking up contract for "${contractorName}"...`);

    const contractor = await fetchContractor(contractorName);

    if (!contractor) {
      return {
        content: [{ type: "text", text: `No contract found for "${contractorName}". Use list_contractors to see available agreements.` }],
        isError: true,
      };
    }

    if (contractor.status !== "active") {
      return {
        content: [{ type: "text", text: `Contract with "${contractorName}" is ${contractor.status.toUpperCase()}. Cannot proceed without an active agreement.` }],
        isError: true,
      };
    }

    log(`Calling ${contractorName} (${contractor.model})...`);
    const response = await callContractor(contractor, prompt);
    log(`${contractorName} responded (${response.length} chars)`);

    return {
      content: [{ type: "text", text: `[${contractorName} / ${contractor.model}]\n\n${response}` }],
    };
  }

  return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
});

const transport = new StdioServerTransport();
await server.connect(transport);
