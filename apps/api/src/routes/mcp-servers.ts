import { Router } from "express";
import path from "path";
import fs from "fs";
import { prisma } from "../lib/db";

export const mcpServerRoutes = Router();

const MUXAI_IO_ROOT = path.resolve(process.cwd(), "../..");
const REGISTRY_PATH = path.join(MUXAI_IO_ROOT, "config/mcp-registry.json");

// GET /api/mcp-servers — built-in (from registry) + custom (from DB)
mcpServerRoutes.get("/", async (_req, res) => {
  try {
    const builtinServers = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8"));
    const customServers = await prisma.mcpServer.findMany({ orderBy: { createdAt: "asc" } });
    res.json({ rootPath: MUXAI_IO_ROOT, servers: builtinServers, customServers });
  } catch {
    res.status(500).json({ error: "Failed to load MCP servers" });
  }
});

// POST /api/mcp-servers — add a custom MCP server
mcpServerRoutes.post("/", async (req, res) => {
  const { name, label, command, args, headers, description } = req.body as {
    name: string; label: string; command: string; args?: string[];
    headers?: Record<string, string>; description?: string;
  };

  if (!name || !label || !command) {
    res.status(400).json({ error: "name, label, and command are required" });
    return;
  }

  const server = await prisma.mcpServer.create({
    data: { name, label, command, args: args ?? [], headers: headers ?? undefined, description },
  });
  res.status(201).json(server);
});

// POST /api/mcp-servers/:id/test — test connectivity and tool discovery
mcpServerRoutes.post("/:id/test", async (req, res) => {
  try {
    const server = await prisma.mcpServer.findUnique({ where: { id: req.params.id } });
    if (!server) { res.status(404).json({ ok: false, error: "Server not found" }); return; }

    const isHttp = server.command.startsWith("http://") || server.command.startsWith("https://");

    if (isHttp) {
      // HTTP MCP: send initialize, then tools/list
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        ...(server.headers as Record<string, string> ?? {}),
      };

      // Helper: parse response that may be JSON or SSE
      async function parseResponse(r: Response): Promise<Record<string, unknown> | null> {
        const ct = r.headers.get("content-type") ?? "";
        if (ct.includes("text/event-stream")) {
          const reader = r.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          const deadline = Date.now() + 8000;
          while (Date.now() < deadline) {
            const { done, value } = await reader.read();
            if (value) buffer += decoder.decode(value, { stream: true });
            for (const line of buffer.split("\n")) {
              if (line.startsWith("data:")) {
                const data = line.slice(5).trim();
                if (data) {
                  try { reader.cancel().catch(() => {}); return JSON.parse(data); } catch {}
                }
              }
            }
            if (done) break;
          }
          reader.cancel().catch(() => {});
          return null;
        }
        return r.json();
      }

      // Step 1: Initialize — this determines if the connection works
      const initRes = await fetch(server.command, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "muxai-test", version: "1.0.0" } } }),
        signal: AbortSignal.timeout(10000),
      });

      if (!initRes.ok) {
        const body = await initRes.text().catch(() => "");
        res.json({ ok: false, error: `HTTP ${initRes.status}${body ? `: ${body.slice(0, 200)}` : ""}` });
        return;
      }

      const initJson = await parseResponse(initRes);
      if (initJson?.error) {
        const err = initJson.error as { message?: string };
        res.json({ ok: false, error: `MCP error: ${err.message || JSON.stringify(initJson.error)}` });
        return;
      }

      // Connection is good — extract server info
      const serverInfo = (initJson?.result as Record<string, unknown> | undefined)?.serverInfo as { name?: string } | undefined;
      const sessionId = initRes.headers.get("mcp-session-id");
      const toolHeaders = { ...headers, ...(sessionId ? { "mcp-session-id": sessionId } : {}) };

      // Step 2: Try to list tools — optional, don't fail if this doesn't work
      let tools: { name: string; description?: string }[] = [];
      try {
        const toolsRes = await fetch(server.command, {
          method: "POST",
          headers: toolHeaders,
          body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
          signal: AbortSignal.timeout(10000),
        });
        if (toolsRes.ok) {
          const toolsJson = await parseResponse(toolsRes);
          const rawTools = (toolsJson?.result as Record<string, unknown> | undefined)?.tools as { name: string; description?: string }[] | undefined;
          if (rawTools) tools = rawTools.map((t) => ({ name: t.name, description: t.description }));
        }
      } catch {}

      res.json({ ok: true, serverName: serverInfo?.name, tools });
    } else {
      // stdio MCP: spawn process, send tools/list, read response
      const { spawn } = await import("child_process");
      const args = (server.args as string[]) ?? [];
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(server.command, args, {
          stdio: ["pipe", "pipe", "pipe"],
          cwd: MUXAI_IO_ROOT,
          env: { ...process.env },
        });
      } catch (err: any) {
        return res.status(500).json({ ok: false, error: `Failed to spawn MCP server: ${err.message}` });
      }

      let stdout = "";
      let stderr = "";
      child.stdout!.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr!.on("data", (d: Buffer) => { stderr += d.toString(); });

      // Send initialize then tools/list
      child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "muxai-test", version: "1.0.0" } } }) + "\n");
      child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n");

      const timeout = setTimeout(() => { child.kill("SIGTERM"); }, 10000);

      await new Promise<void>((resolve, reject) => {
        const check = () => {
          // Look for the tools/list response (id: 2)
          if (stdout.includes('"id":2') || stdout.includes('"id": 2')) {
            clearTimeout(timeout);
            child.kill("SIGTERM");
            resolve();
          }
        };
        child.stdout!.on("data", check);
        child.on("close", () => { clearTimeout(timeout); resolve(); });
        child.on("error", (err) => { clearTimeout(timeout); reject(err); });
      });

      // Parse the tools/list response
      const lines = stdout.split("\n").filter(Boolean);
      let tools: { name: string; description?: string }[] = [];
      let serverName: string | undefined;

      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1 && msg.result?.serverInfo) {
            serverName = msg.result.serverInfo.name;
          }
          if (msg.id === 2 && msg.result?.tools) {
            tools = msg.result.tools.map((t: { name: string; description?: string }) => ({ name: t.name, description: t.description }));
          }
          if (msg.error) {
            res.json({ ok: false, error: `MCP error: ${msg.error.message || JSON.stringify(msg.error)}` });
            return;
          }
        } catch {}
      }

      if (tools.length === 0 && stderr) {
        res.json({ ok: false, error: `Server stderr: ${stderr.slice(0, 300)}` });
        return;
      }

      res.json({ ok: true, serverName, tools });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.json({ ok: false, error: message });
  }
});

// DELETE /api/mcp-servers/:id — remove a custom MCP server
mcpServerRoutes.delete("/:id", async (req, res) => {
  await prisma.mcpServer.delete({ where: { id: req.params.id } });
  res.status(204).end();
});
