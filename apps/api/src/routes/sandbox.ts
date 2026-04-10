import { Router } from "express";
import { spawn } from "child_process";
import { emitRunLog, emitRunDone, emitRunSession, onRunEvent } from "../services/run-events";
import { CLAUDE_CLI, MUXAI_ROOT, buildMcpConfig } from "../services/claude-spawn";
import { parseStreamJson } from "../services/stream-parser";
import { trackProcess, stopProcess, untrackProcess } from "../services/process-manager";

export const sandboxRoutes = Router();

// POST /api/sandbox/run
sandboxRoutes.post("/run", async (req, res) => {
  const { model = "claude-sonnet-4-6", systemPrompt, prompt, useMcp = true, sessionId } = req.body as {
    model?: string; systemPrompt?: string; prompt: string; useMcp?: boolean; sessionId?: string;
  };

  if (!prompt?.trim()) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  const runId = crypto.randomUUID();

  const args = [
    "--model", model,
    "--max-turns", "20",
    "--dangerously-skip-permissions",
    "--output-format", "stream-json",
    "--verbose",
    "--print", prompt,
  ];

  if (sessionId) args.splice(0, 0, "--resume", sessionId);
  if (systemPrompt?.trim()) args.splice(args.indexOf("--output-format"), 0, "--system-prompt", systemPrompt);

  if (useMcp) {
    try {
      const mcpConfig = await buildMcpConfig();
      args.splice(args.indexOf("--output-format"), 0, "--mcp-config", mcpConfig, "--strict-mcp-config");
    } catch { /* proceed without MCP if registry unreadable */ }
  }

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(CLAUDE_CLI, args, { cwd: MUXAI_ROOT, env: process.env as Record<string, string>, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err: any) {
    emitRunLog(runId, `Failed to spawn process: ${err.message}\n`);
    emitRunDone(runId, "failed", -1);
    return res.status(500).json({ error: `Failed to start sandbox process: ${err.message}` });
  }
  trackProcess(runId, child);

  let stdoutBuffer = "";

  child.stdout!.on("data", (data: Buffer) => {
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const { text, sessionId: sid } = parseStreamJson(line);
      if (sid) emitRunSession(runId, sid);
      if (!text) continue;
      emitRunLog(runId, text + "\n");
    }
  });

  child.stderr!.on("data", (data: Buffer) => {
    for (const line of data.toString().split("\n")) {
      if (!line.trim()) continue;
      if (/\b(error|failed|fatal)\b/i.test(line)) emitRunLog(runId, `✗ ${line}\n`);
    }
  });

  child.on("close", (code) => {
    untrackProcess(runId);
    emitRunDone(runId, code === 0 ? "succeeded" : "failed", code ?? -1);
  });

  child.on("error", (err) => {
    untrackProcess(runId);
    emitRunLog(runId, `✗ ${err.message}\n`);
    emitRunDone(runId, "failed", -1);
  });

  res.json({ runId });
});

// POST /api/sandbox/stop/:runId
sandboxRoutes.post("/stop/:runId", (req, res) => {
  stopProcess(req.params.runId);
  res.status(204).end();
});

// GET /api/sandbox/:runId/stream
sandboxRoutes.get("/:runId/stream", (req, res) => {
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
