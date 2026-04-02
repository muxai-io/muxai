import { Router } from "express";
import { spawn } from "child_process";
import path from "path";
import { readFileSync } from "fs";
import { prisma } from "../lib/db";
import { emitRunLog, emitRunDone, emitRunSession, onRunEvent } from "../services/run-events";

export const sandboxRoutes = Router();

const CLAUDE_CLI = process.env.CLAUDE_CLI_PATH || "claude";
const MUXAI_ROOT = path.resolve(process.cwd(), "../..");
const REGISTRY_PATH = path.join(MUXAI_ROOT, "config/mcp-registry.json");

// Active sandbox processes — for stop support
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

  const child = spawn(CLAUDE_CLI, args, { cwd: MUXAI_ROOT, env: process.env as Record<string, string>, shell: false });
  active.set(runId, child);

  let stdoutBuffer = "";

  child.stdout.on("data", (data: Buffer) => {
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

  child.stderr.on("data", (data: Buffer) => {
    for (const line of data.toString().split("\n")) {
      if (!line.trim()) continue;
      if (/\b(error|failed|fatal)\b/i.test(line)) emitRunLog(runId, `✗ ${line}\n`);
    }
  });

  child.on("close", (code) => {
    active.delete(runId);
    emitRunDone(runId, code === 0 ? "succeeded" : "failed", code ?? -1);
  });

  child.on("error", (err) => {
    active.delete(runId);
    emitRunLog(runId, `✗ ${err.message}\n`);
    emitRunDone(runId, "failed", -1);
  });

  res.json({ runId });
});

// POST /api/sandbox/stop/:runId
sandboxRoutes.post("/stop/:runId", (req, res) => {
  const child = active.get(req.params.runId);
  if (child) {
    child.kill("SIGTERM");
    active.delete(req.params.runId);
  }
  res.status(204).end();
});

// GET /api/sandbox/:runId/stream
sandboxRoutes.get("/:runId/stream", (req, res) => {
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
