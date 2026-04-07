#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "orchestrator", version: "1.0.0" }, { capabilities: { tools: {} } });

function getTeam() {
  const raw = process.env.MUXAI_REPORTS;
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function getApiUrl() {
  return process.env.MUXAI_API_URL || "http://localhost:3001";
}

function internalHeaders() {
  const secret = process.env.MUXAI_INTERNAL_SECRET;
  return secret ? { "x-muxai-internal": secret } : {};
}

function log(msg) {
  process.stderr.write(`[orchestrator] ${msg}\n`);
}

async function invokeAgent(agentId, task) {
  const res = await fetch(`${getApiUrl()}/api/agents/${agentId}/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...internalHeaders() },
    body: JSON.stringify({ task }),
  });
  if (!res.ok) throw new Error(`Failed to invoke agent ${agentId}: ${res.status}`);
  try { return await res.json(); } catch { throw new Error(`Invalid JSON from invoke endpoint for agent ${agentId}`); }
}

async function pollRun(runId, agentName, intervalMs = 4000, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs;
  let dots = 0;
  while (Date.now() < deadline) {
    const res = await fetch(`${getApiUrl()}/api/runs/${runId}`, { headers: internalHeaders() });
    if (!res.ok) throw new Error(`Failed to poll run ${runId}: ${res.status}`);
    let run;
    try { run = await res.json(); } catch { throw new Error(`Invalid JSON from poll endpoint for run ${runId}`); }
    if (run.status !== "running" && run.status !== "queued") {
      log(`${agentName} finished — status: ${run.status}`);
      return run;
    }
    dots++;
    if (dots % 3 === 0) log(`${agentName} still running... (${Math.round((Date.now() - (deadline - timeoutMs)) / 1000)}s)`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Run ${runId} timed out after ${timeoutMs / 1000}s`);
}

async function invokeAndWait(agentId, agentName, task) {
  log(`Invoking ${agentName} (${agentId})...`);
  const run = await invokeAgent(agentId, task);
  log(`${agentName} run started — runId: ${run.id}`);
  return pollRun(run.id, agentName);
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "run_team",
      description:
        "Invoke all direct reports in parallel and collect their findings. " +
        "Pass a task to give all reporters shared context. Each reporter picks out what is relevant to their role. " +
        "If no task is provided, each reporter runs their own default prompt. " +
        "Returns each reporter's name, role, status, and full output.",
      inputSchema: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "Optional task or context sent to all reporters. Each reporter will use the parts relevant to their role and ignore the rest.",
          },
        },
        required: [],
      },
    },
    {
      name: "ask_reporter",
      description:
        "Invoke one specific direct report by name and wait for their result. Use when you need a second opinion, want to re-run a single analyst, or need to resolve a conflict between reporters.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The name of the reporter to invoke (must match the agent name exactly).",
          },
          task: {
            type: "string",
            description: "Optional task or context to pass to the reporter. Overrides their default prompt.",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "get_my_decisions",
      description: "Fetch your own recent decisions (trade results). " + "Use this before making a new decision to review what you decided previously.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of recent decisions to fetch (default 5, max 20).",
          },
        },
        required: [],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const team = getTeam();

  if (name === "run_team") {
    if (team.length === 0) {
      return { content: [{ type: "text", text: "No direct reports found. Make sure this agent has reporters assigned via reportsTo." }] };
    }

    const task = args?.task;
    log(`Running team of ${team.length}: ${team.map((m) => m.name).join(", ")}${task ? ` — task: "${task}"` : ""}`);

    const results = await Promise.allSettled(
      team.map(async (member) => {
        const run = await invokeAndWait(member.id, member.name, task);
        return { name: member.name, role: member.role, status: run.status, result: run.logs ?? "" };
      }),
    );

    const output = results.map((r, i) => {
      if (r.status === "fulfilled") {
        const { name, role, status, result } = r.value;
        return `## ${name} (${role})\nStatus: ${status}\n\n${result}`;
      } else {
        return `## ${team[i].name} (${team[i].role})\nStatus: error\n\n${r.reason?.message ?? "Unknown error"}`;
      }
    });

    return { content: [{ type: "text", text: output.join("\n\n---\n\n") }] };
  }

  if (name === "ask_reporter") {
    const reporterName = args?.name;
    const normalize = (s) => s.toLowerCase().replace(/[\s_-]+/g, "");
    const member = team.find((m) => m.name === reporterName) || team.find((m) => normalize(m.name) === normalize(reporterName ?? ""));
    if (!member) {
      const available = team.map((m) => m.name).join(", ");
      return { content: [{ type: "text", text: `Reporter "${reporterName}" not found. Available reporters: ${available || "none"}` }] };
    }

    const run = await invokeAndWait(member.id, member.name, args?.task);
    const output = `## ${member.name} (${member.role})\nStatus: ${run.status}\n\n${run.logs ?? ""}`;
    return { content: [{ type: "text", text: output }] };
  }

  if (name === "get_my_decisions") {
    const agentId = process.env.MUXAI_AGENT_ID;
    const limit = args?.limit || 5;

    if (!agentId) {
      return { content: [{ type: "text", text: "Could not determine agent identity from the environment." }] };
    }

    log(`Fetching previous decisions for agent ${agentId} (limit: ${limit})`);

    try {
      const url = `${getApiUrl()}/api/agents/decisions?agentId=${encodeURIComponent(agentId)}&limit=${limit}`;
      const res = await fetch(url, { headers: internalHeaders() });
      if (!res.ok) {
        const err = await res.text();
        return { content: [{ type: "text", text: `Failed to fetch decisions: ${res.status} — ${err}` }] };
      }
      const data = await res.json();

      if (data.count === 0) {
        return { content: [{ type: "text", text: `No previous decisions found for "${agentName}".` }] };
      }

      const lines = data.decisions.map((d, i) => {
        const date = d.finishedAt ? new Date(d.finishedAt).toISOString() : "unknown";
        return `### Decision ${i + 1} (${date})\n\`\`\`json\n${JSON.stringify(d.decision, null, 2)}\n\`\`\``;
      });

      const header = `## Previous Decisions — ${data.agentName} (${data.agentRole})\n${data.count} most recent:\n`;
      return { content: [{ type: "text", text: header + lines.join("\n\n") }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error fetching decisions: ${err.message}` }] };
    }
  }

  return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
