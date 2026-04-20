#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "control-tower", version: "1.0.0" }, { capabilities: { tools: {} } });

function getApiUrl() {
  return process.env.MUXAI_API_URL || "http://localhost:3001";
}

function internalHeaders() {
  const secret = process.env.MUXAI_INTERNAL_SECRET;
  return secret ? { "x-muxai-internal": secret } : {};
}

function log(msg) {
  process.stderr.write(`[control-tower] ${msg}\n`);
}

async function listAgents() {
  const res = await fetch(`${getApiUrl()}/api/agents`, { headers: internalHeaders() });
  if (!res.ok) throw new Error(`Failed to list agents: ${res.status}`);
  return res.json();
}

async function invokeAgent(agentId, task) {
  const res = await fetch(`${getApiUrl()}/api/agents/${agentId}/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...internalHeaders() },
    body: JSON.stringify(task ? { task } : {}),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to invoke agent ${agentId}: ${res.status} — ${err}`);
  }
  return res.json();
}

async function getRun(runId) {
  const res = await fetch(`${getApiUrl()}/api/runs/${runId}`, { headers: internalHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch run ${runId}: ${res.status}`);
  return res.json();
}

async function pollRun(runId, agentName, intervalMs = 4000, timeoutMs = 600000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await getRun(runId);
    if (run.status !== "running" && run.status !== "queued") {
      log(`${agentName} finished — status: ${run.status}`);
      return run;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Run ${runId} timed out after ${timeoutMs / 1000}s`);
}

function findAgent(agents, query) {
  const normalize = (s) => String(s).toLowerCase().replace(/[\s_-]+/g, "");
  const q = normalize(query);
  return (
    agents.find((a) => a.id === query) ||
    agents.find((a) => normalize(a.name) === q) ||
    agents.find((a) => normalize(a.role) === q)
  );
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_agents",
      description:
        "List every agent in this muxAI deployment (excluding the Control Tower itself). " +
        "Returns id, name, role, title, status, total runs, and whether the agent has a schedule. " +
        "Use this to see who you can invoke or inspect.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "invoke_agent",
      description:
        "Invoke a specific agent by name, role, or id and wait for the run to complete. " +
        "Pass an optional task to override the agent's default prompt for this run. " +
        "Returns the final status and any result card / logs.",
      inputSchema: {
        type: "object",
        properties: {
          agent: {
            type: "string",
            description: "Name, role, or id of the agent to invoke. Use list_agents first if unsure.",
          },
          task: {
            type: "string",
            description: "Optional task or instructions for this run. Omit to use the agent's default prompt.",
          },
        },
        required: ["agent"],
      },
    },
    {
      name: "get_run_status",
      description:
        "Fetch the status, result, and logs of a single run by id. " +
        "Use this when you want to inspect an older run or an in-flight run you didn't start.",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string", description: "The run id to look up." },
        },
        required: ["runId"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "list_agents") {
    const agents = await listAgents();
    if (agents.length === 0) {
      return { content: [{ type: "text", text: "No agents exist yet. Create one from the muxAI dashboard to get started." }] };
    }
    const lines = agents.map((a) => {
      const heartbeat = a.runtimeConfig?.heartbeat;
      const schedule = heartbeat?.enabled ? `scheduled (${heartbeat.cron})` : "manual";
      return `- **${a.name}** (${a.role}) · status: ${a.status} · runs: ${a._count?.runs ?? 0} · ${schedule} · id: \`${a.id}\``;
    });
    return { content: [{ type: "text", text: `## Agents (${agents.length})\n\n${lines.join("\n")}` }] };
  }

  if (name === "invoke_agent") {
    const query = args?.agent;
    const task = args?.task;
    if (!query) {
      return { content: [{ type: "text", text: "agent parameter is required." }] };
    }
    const agents = await listAgents();
    const target = findAgent(agents, query);
    if (!target) {
      const available = agents.map((a) => `${a.name} (${a.role})`).join(", ");
      return { content: [{ type: "text", text: `Agent "${query}" not found. Available: ${available || "none"}` }] };
    }
    log(`Invoking ${target.name} (${target.id})${task ? ` with task: "${task}"` : ""}`);
    const run = await invokeAgent(target.id, task);
    const finished = await pollRun(run.id, target.name);
    const result = finished.resultJson ? `\n\n\`\`\`json\n${JSON.stringify(finished.resultJson, null, 2)}\n\`\`\`` : "";
    const logs = finished.logs ? `\n\n${finished.logs}` : "";
    return {
      content: [
        {
          type: "text",
          text: `## ${target.name} (${target.role})\nStatus: ${finished.status}\nRun: ${finished.id}${result}${logs}`,
        },
      ],
    };
  }

  if (name === "get_run_status") {
    const runId = args?.runId;
    if (!runId) {
      return { content: [{ type: "text", text: "runId parameter is required." }] };
    }
    try {
      const run = await getRun(runId);
      const agentLine = run.agent ? `Agent: ${run.agent.name} (${run.agent.role})\n` : "";
      const result = run.resultJson ? `\n\n\`\`\`json\n${JSON.stringify(run.resultJson, null, 2)}\n\`\`\`` : "";
      const logs = run.logs ? `\n\n${run.logs}` : "";
      return {
        content: [
          {
            type: "text",
            text: `## Run ${run.id}\n${agentLine}Status: ${run.status}\nStarted: ${run.startedAt ?? "—"}\nFinished: ${run.finishedAt ?? "—"}${result}${logs}`,
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error fetching run: ${err.message}` }] };
    }
  }

  return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
