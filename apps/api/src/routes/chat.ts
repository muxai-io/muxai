import { Router } from "express";
import { spawn } from "child_process";
import { prisma } from "../lib/db";
import { emitRunLog, emitRunDone, emitRunSession, onRunEvent } from "../services/run-events";
import { INTERNAL_SECRET } from "../services/internal-secret";
import { CLAUDE_CLI, MUXAI_ROOT, buildMcpConfig } from "../services/claude-spawn";
import { parseStreamJson } from "../services/stream-parser";
import { trackProcess, stopProcess, untrackProcess } from "../services/process-manager";

export const chatRoutes = Router();

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
    const disallowedTools = config.disallowedTools as string | undefined;

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
    if (disallowedTools) args.splice(args.indexOf("--output-format"), 0, "--disallowedTools", disallowedTools);

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

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(CLAUDE_CLI, args, { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err: any) {
    emitRunLog(runId, `Failed to spawn process: ${err.message}\n`);
    emitRunDone(runId, "failed", -1);
    return res.status(500).json({ error: `Failed to start chat process: ${err.message}` });
  }
  trackProcess(runId, child);

  const chunks: string[] = [];
  let stdoutBuffer = "";

  child.stdout!.on("data", (data: Buffer) => {
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

  child.stderr!.on("data", (data: Buffer) => {
    for (const line of data.toString().split("\n")) {
      if (!line.trim()) continue;
      if (/\b(error|failed|fatal)\b/i.test(line)) emitRunLog(runId, `✗ ${line}\n`);
    }
  });

  child.on("close", async (code) => {
    untrackProcess(runId);
    const succeeded = code === 0;
    const fullResponse = chunks.join("\n").trim();

    try {
      if (fullResponse) {
        await prisma.chatMessage.create({
          data: { sessionId: session.id, role: "assistant", content: fullResponse },
        });
      }
    } catch (dbErr: any) {
      console.error(`[chat] DB write failed on close: ${dbErr.message}`);
    }

    emitRunDone(runId, succeeded ? "succeeded" : "failed", code ?? -1);
  });

  child.on("error", (err) => {
    untrackProcess(runId);
    emitRunLog(runId, `✗ ${err.message}\n`);
    emitRunDone(runId, "failed", -1);
  });

  res.json({ runId });
});

// POST /api/chat/stop/:runId
chatRoutes.post("/stop/:runId", (req, res) => {
  stopProcess(req.params.runId);
  res.status(204).end();
});

// GET /api/chat/:runId/stream
chatRoutes.get("/:runId/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const unsubscribe = onRunEvent(req.params.runId, (event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === "done") {
        res.end();
        unsubscribe();
      }
    } catch {
      unsubscribe();
    }
  });

  req.on("close", () => unsubscribe());
});
