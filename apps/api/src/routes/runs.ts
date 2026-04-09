import { Router } from "express";
import { prisma, Prisma } from "../lib/db";
import { onRunEvent } from "../services/run-events";

export const runRoutes = Router();

// GET /api/runs — recent runs across all agents
// ?persistedOnly=true  — only runs from agents with persistLogs: true in adapterConfig
// ?withResults=true    — only runs that have a resultJson captured
runRoutes.get("/", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const persistedOnly = req.query.persistedOnly === "true";
  const withResults = req.query.withResults === "true";

  const runs = await prisma.heartbeatRun.findMany({
    where: {
      ...(persistedOnly ? { agent: { adapterConfig: { path: ["persistLogs"], equals: true } } } : {}),
      ...(withResults ? { resultJson: { not: Prisma.DbNull } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      agent: { select: { id: true, name: true, role: true, adapterConfig: true } },
    },
  });
  res.json(runs);
});

// GET /api/runs/:id
runRoutes.get("/:id", async (req, res) => {
  const run = await prisma.heartbeatRun.findUnique({
    where: { id: req.params.id },
    include: {
      agent: { select: { id: true, name: true, role: true, adapterConfig: true } },
    },
  });
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.json(run);
});

// GET /api/runs/:id/logs
runRoutes.get("/:id/logs", async (req, res) => {
  const run = await prisma.heartbeatRun.findUnique({
    where: { id: req.params.id },
    select: { id: true, logs: true, status: true },
  });
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.json({ id: run.id, status: run.status, logs: run.logs ?? "" });
});

// GET /api/runs/:id/stream — SSE live log stream
runRoutes.get("/:id/stream", async (req, res) => {
  const run = await prisma.heartbeatRun.findUnique({
    where: { id: req.params.id },
    select: { id: true, status: true, logs: true },
  });
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  // If already finished, just return the stored logs as a single SSE flush
  if (run.status !== "running" && run.status !== "queued") {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    if (run.logs) {
      res.write(`data: ${JSON.stringify({ type: "log", data: run.logs })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ type: "done", status: run.status, exitCode: null })}\n\n`);
    res.end();
    return;
  }

  // Run is still in progress — set up SSE and subscribe to live events
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const unsubscribe = onRunEvent(run.id, (event) => {
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
