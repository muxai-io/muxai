import { Router } from "express";
import { spawn } from "child_process";
import { readFileSync } from "fs";
import path from "path";
import { prisma } from "../lib/db";
import { emitRunLog, emitRunDone, emitRunSession, onRunEvent } from "../services/run-events";
import { INTERNAL_SECRET } from "../services/internal-secret";

export const chatRoutes = Router();

const CLAUDE_CLI = process.env.CLAUDE_CLI_PATH || "claude";
const MUXAI_ROOT = path.resolve(process.cwd(), "../..");
const REGISTRY_PATH = path.join(MUXAI_ROOT, "config/mcp-registry.json");

const active = new Map<string, ReturnType<typeof spawn>>();

async function buildMcpConfig(): Promise<string> {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as {
    id: string; command: string; args: string[];
  }[];
  // Check for globally disabled built-in servers
  const disabledSetting = await prisma.setting.findUnique({ where: { key: "mcp_disabled_servers" } });
  const disabled: string[] = disabledSetting?.value ? JSON.parse(disabledSetting.value) : [];
  const mcpServers: Record<string, unknown> = {};
  for (const s of registry) {
    if (disabled.includes(s.id)) continue;
    mcpServers[s.id] = {
      command: s.command,
      args: s.args.map((a) => (path.isAbsolute(a) ? a : path.join(MUXAI_ROOT, a))),
    };
  }
  const custom = await prisma.mcpServer.findMany();
  for (const s of custom) {
    const isHttp = s.command.startsWith("http://") || s.command.startsWith("https://");
    mcpServers[s.name] = isHttp
      ? { type: "http", url: s.command, ...(s.headers ? { headers: s.headers } : {}) }
      : { command: s.command, args: s.args as string[] };
  }
  return JSON.stringify({ mcpServers });
}

function parseStreamJson(line: string): { text: string | null; sessionId?: string } {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;
    if (obj.type === "assistant") {
      const msg = obj.message as { content?: unknown[] } | undefined;
      const parts: string[] = [];
      for (const block of msg?.content ?? []) {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string" && b.text.trim()) parts.push(b.text.trim());
        if (b.type === "tool_use") {
          const input = b.input as Record<string, unknown> | undefined;
          const hint = input
            ? Object.entries(input).slice(0, 2).map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 50)}`).join(", ")
            : "";
          parts.push(`▶ ${b.name}${hint ? `(${hint})` : ""}`);
        }
      }
      return { text: parts.length ? parts.join("\n") : null };
    }
    if (obj.type === "result") {
      const r = obj as { subtype?: string; result?: string; is_error?: boolean; session_id?: string };
      const sessionId = r.session_id;
      if (r.is_error || r.subtype === "error") return { text: `✗ ${r.result ?? "unknown error"}`, sessionId };
      return { text: null, sessionId };
    }
    return { text: null };
  } catch {
    return { text: line.trim() || null };
  }
}

// GET /api/chat/session?agentId=<id>  — get or create session + history
chatRoutes.get("/session", async (req, res) => {
  const { agentId } = req.query as { agentId?: string };

  let session = await prisma.chatSession.findFirst({
    where: { agentId: agentId ?? null },
  });

  if (!session) {
    session = await prisma.chatSession.create({
      data: { agentId: agentId ?? null },
    });
  }

  const messages = await prisma.chatMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { ts: "asc" },
  });

  res.json({ session, messages });
});

// POST /api/chat/session/:id/reset — clear messages + claudeSessionId
chatRoutes.post("/session/:id/reset", async (req, res) => {
  const { id } = req.params;
  await prisma.chatMessage.deleteMany({ where: { sessionId: id } });
  await prisma.chatSession.update({ where: { id }, data: { claudeSessionId: null } });
  res.status(204).end();
});

// POST /api/chat/send
chatRoutes.post("/send", async (req, res) => {
  const { chatSessionId, prompt, agentId, useMcp = false } = req.body as {
    chatSessionId: string;
    prompt: string;
    agentId?: string;
    useMcp?: boolean;
  };

  if (!prompt?.trim()) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  const session = await prisma.chatSession.findUnique({ where: { id: chatSessionId } });
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  // Save user message
  await prisma.chatMessage.create({
    data: { sessionId: session.id, role: "user", content: prompt },
  });

  const runId = crypto.randomUUID();
  let args: string[];
  let cwd = MUXAI_ROOT;

  if (agentId) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    const config = agent.adapterConfig as Record<string, unknown>;
    const model = (config.model as string) || "claude-sonnet-4-6";
    const systemPrompt = config.promptTemplate as string | undefined;
    cwd = (config.cwd as string) || MUXAI_ROOT;
    const isBuiltin = cwd === MUXAI_ROOT;
    const maxTurns = (config.maxTurnsPerRun as number) || 20;

    args = [
      "--model", model,
      "--max-turns", String(maxTurns),
      "--dangerously-skip-permissions",
      "--output-format", "stream-json",
      "--verbose",
      "--print", prompt,
    ];

    if (session.claudeSessionId) args.splice(0, 0, "--resume", session.claudeSessionId);
    if (systemPrompt?.trim()) args.splice(args.indexOf("--output-format"), 0, "--system-prompt", systemPrompt);

    if (isBuiltin) {
      try {
        const mcpConfig = await buildMcpConfig();
        args.splice(args.indexOf("--output-format"), 0, "--mcp-config", mcpConfig, "--strict-mcp-config");
      } catch { /* proceed without MCP */ }
    }
  } else {
    // General chat
    args = [
      "--model", "claude-sonnet-4-6",
      "--max-turns", "20",
      "--dangerously-skip-permissions",
      "--output-format", "stream-json",
      "--verbose",
      "--print", prompt,
    ];

    if (session.claudeSessionId) args.splice(0, 0, "--resume", session.claudeSessionId);

    if (useMcp) {
      try {
        const mcpConfig = await buildMcpConfig();
        args.splice(args.indexOf("--output-format"), 0, "--mcp-config", mcpConfig, "--strict-mcp-config");
      } catch { /* proceed without MCP */ }
    }
  }

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    MUXAI_API_URL: `http://localhost:${process.env.API_PORT || 3001}`,
    MUXAI_INTERNAL_SECRET: INTERNAL_SECRET,
    ...(agentId ? { MUXAI_AGENT_ID: agentId } : {}),
  };

  const child = spawn(CLAUDE_CLI, args, { cwd, env, shell: false });
  active.set(runId, child);

  const chunks: string[] = [];
  let stdoutBuffer = "";

  child.stdout.on("data", (data: Buffer) => {
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const { text, sessionId: sid } = parseStreamJson(line);
      if (sid) {
        emitRunSession(runId, sid);
        prisma.chatSession.update({ where: { id: session.id }, data: { claudeSessionId: sid } }).catch(() => {});
      }
      if (!text) continue;
      chunks.push(text);
      emitRunLog(runId, text + "\n");
    }
  });

  child.stderr.on("data", (data: Buffer) => {
    for (const line of data.toString().split("\n")) {
      if (!line.trim()) continue;
      if (/\b(error|failed|fatal)\b/i.test(line)) emitRunLog(runId, `✗ ${line}\n`);
    }
  });

  child.on("close", async (code) => {
    active.delete(runId);
    const succeeded = code === 0;
    const fullResponse = chunks.join("\n").trim();

    if (fullResponse) {
      await prisma.chatMessage.create({
        data: { sessionId: session.id, role: "assistant", content: fullResponse },
      });
    }

    emitRunDone(runId, succeeded ? "succeeded" : "failed", code ?? -1);
  });

  child.on("error", (err) => {
    active.delete(runId);
    emitRunLog(runId, `✗ ${err.message}\n`);
    emitRunDone(runId, "failed", -1);
  });

  res.json({ runId });
});

// POST /api/chat/stop/:runId
chatRoutes.post("/stop/:runId", (req, res) => {
  const child = active.get(req.params.runId);
  if (child) {
    child.kill("SIGTERM");
    active.delete(req.params.runId);
  }
  res.status(204).end();
});

// GET /api/chat/:runId/stream
chatRoutes.get("/:runId/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const unsubscribe = onRunEvent(req.params.runId, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (event.type === "done") {
      res.end();
      unsubscribe();
    }
  });

  req.on("close", () => unsubscribe());
});
