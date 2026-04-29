import { Router } from "express";
import { prisma, Prisma } from "../lib/db";
import { onRunEvent } from "../services/run-events";
import { resolveTradeFromCandles, type TradeSide } from "../services/trade-resolver";

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

// POST /api/runs/:id/outcome — mark the outcome of a run (user-initiated)
// Body: { outcome: string | null, fields?: Record<string, string|number|boolean> }
// outcome = null clears both outcome and fields.
runRoutes.post("/:id/outcome", async (req, res) => {
  const { outcome, fields } = req.body as { outcome?: string | null; fields?: Record<string, unknown> | null };

  const label = typeof outcome === "string" ? outcome.trim() : outcome;
  if (label !== null && label !== undefined && typeof label !== "string") {
    res.status(400).json({ error: "outcome must be a string or null" });
    return;
  }
  if (typeof label === "string" && label.length > 80) {
    res.status(400).json({ error: "outcome label must be 80 characters or fewer" });
    return;
  }
  if (fields !== undefined && fields !== null && (typeof fields !== "object" || Array.isArray(fields))) {
    res.status(400).json({ error: "fields must be an object" });
    return;
  }

  const run = await prisma.heartbeatRun.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  const cleared = !label;
  const updated = await prisma.heartbeatRun.update({
    where: { id: run.id },
    data: {
      outcome: cleared ? null : label,
      outcomeFields: cleared ? Prisma.DbNull : (fields && Object.keys(fields).length > 0 ? (fields as Prisma.InputJsonValue) : Prisma.DbNull),
      outcomeAt: cleared ? null : new Date(),
    },
    select: { id: true, outcome: true, outcomeFields: true, outcomeAt: true },
  });
  res.json(updated);
});

// POST /api/runs/:id/manual-entry — user marks the trade as entered (real fill)
// Body: { fill: number, at?: number } — at defaults to now
// Records resolutionMeta.manualEntry; tick will re-resolve TP/SL on next pass.
runRoutes.post("/:id/manual-entry", async (req, res) => {
  const { fill, at } = req.body as { fill?: unknown; at?: unknown };
  if (typeof fill !== "number" || !Number.isFinite(fill) || fill <= 0) {
    res.status(400).json({ error: "fill must be a positive number" });
    return;
  }
  const atMs = typeof at === "number" && Number.isFinite(at) ? at : Date.now();

  const run = await prisma.heartbeatRun.findUnique({
    where: { id: req.params.id },
    select: { id: true, resolutionMeta: true, agent: { select: { adapterConfig: true } } },
  });
  if (!run) { res.status(404).json({ error: "Run not found" }); return; }
  if (!isTradeDecisionRun(run.agent?.adapterConfig)) {
    res.status(400).json({ error: "Run is not a trade-decision card" });
    return;
  }

  const meta = (run.resolutionMeta ?? {}) as Record<string, unknown>;
  const nextMeta = { ...meta, manualEntry: { at: atMs, fill } };

  const updated = await prisma.heartbeatRun.update({
    where: { id: run.id },
    data: {
      resolutionStatus: "active",
      resolutionMeta: nextMeta as object,
      resolutionCheckedAt: new Date(),
    },
    select: { id: true, resolutionStatus: true, resolutionMeta: true },
  });
  res.json(updated);
});

// POST /api/runs/:id/manual-exit — user marks the trade as exited (real exit)
// Body: { price: number, at?: number }
// Synchronously computes outcome using existing manualEntry (or the configured
// entry from result_json as fallback). Writes outcome immediately.
runRoutes.post("/:id/manual-exit", async (req, res) => {
  const { price, at } = req.body as { price?: unknown; at?: unknown };
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    res.status(400).json({ error: "price must be a positive number" });
    return;
  }
  const atMs = typeof at === "number" && Number.isFinite(at) ? at : Date.now();

  const run = await prisma.heartbeatRun.findUnique({
    where: { id: req.params.id },
    select: {
      id: true, resolutionMeta: true, resultJson: true, finishedAt: true,
      agent: { select: { adapterConfig: true } },
    },
  });
  if (!run) { res.status(404).json({ error: "Run not found" }); return; }
  if (!isTradeDecisionRun(run.agent?.adapterConfig)) {
    res.status(400).json({ error: "Run is not a trade-decision card" });
    return;
  }

  const trade = readTradePlan(run.agent!.adapterConfig, run.resultJson);
  if (!trade) {
    res.status(400).json({ error: "Run has no resolvable trade plan" });
    return;
  }

  const meta = (run.resolutionMeta ?? {}) as Record<string, unknown>;
  const existingManualEntry = meta.manualEntry && typeof meta.manualEntry === "object"
    ? meta.manualEntry as { at: number; fill: number }
    : null;
  // If user never marked entry explicitly, fall back to configured entry as fill.
  const manualEntry = existingManualEntry ?? { at: run.finishedAt?.getTime() ?? atMs, fill: trade.entry };
  const manualExit = { at: atMs, price };

  const result = resolveTradeFromCandles({
    side: trade.side,
    entry: trade.entry,
    takeProfit: trade.takeProfit,
    stopLoss: trade.stopLoss,
    decisionAt: run.finishedAt?.getTime() ?? atMs,
    expireBars: trade.expireBars,
    fillTolerancePct: trade.fillTolerancePct,
    candles: [],
    manualEntry,
    manualExit,
  });

  const nextMeta = { ...meta, ...(result.meta as Record<string, unknown>), manualEntry, manualExit };
  const updated = await prisma.heartbeatRun.update({
    where: { id: run.id },
    data: {
      resolutionStatus: result.status,
      resolutionCheckedAt: new Date(),
      resolutionMeta: nextMeta as object,
      ...(result.outcome ? { outcome: result.outcome, outcomeAt: new Date() } : {}),
      ...(result.outcomeFields ? { outcomeFields: result.outcomeFields as object } : {}),
    },
    select: { id: true, outcome: true, outcomeFields: true, resolutionStatus: true, resolutionMeta: true },
  });
  res.json(updated);
});

// ── helpers ─────────────────────────────────────────────────────────────────

function isTradeDecisionRun(adapterConfig: unknown): boolean {
  if (!adapterConfig || typeof adapterConfig !== "object") return false;
  const card = (adapterConfig as Record<string, unknown>).resultCard;
  if (!card || typeof card !== "object") return false;
  return (card as { type?: string }).type === "trade-decision";
}

interface TradePlan {
  side: TradeSide;
  entry: number;
  takeProfit: number;
  stopLoss: number;
  expireBars: number;
  fillTolerancePct: number;
}

function readTradePlan(adapterConfig: unknown, resultJson: unknown): TradePlan | null {
  if (!adapterConfig || typeof adapterConfig !== "object") return null;
  if (!resultJson || typeof resultJson !== "object") return null;
  const card = (adapterConfig as Record<string, unknown>).resultCard as
    | { mapping?: Record<string, string>; autoResolve?: { expireBars?: number; fillTolerancePct?: number } }
    | undefined;
  const mapping = card?.mapping ?? {};
  const k = (slot: string) => mapping[slot]?.trim() || slot;
  const r = resultJson as Record<string, unknown>;

  const sideRaw = r[k("decision")];
  const side = typeof sideRaw === "string" && (sideRaw.toUpperCase() === "LONG" || sideRaw.toUpperCase() === "SHORT")
    ? (sideRaw.toUpperCase() as TradeSide) : null;
  const entry = numberAt(r, k("entry"));
  const tp = numberAt(r, k("take_profit"));
  const sl = numberAt(r, k("stop_loss"));
  if (!side || entry === null || tp === null || sl === null) return null;

  return {
    side,
    entry,
    takeProfit: tp,
    stopLoss: sl,
    expireBars: card?.autoResolve?.expireBars ?? 24,
    fillTolerancePct: typeof card?.autoResolve?.fillTolerancePct === "number" ? card!.autoResolve!.fillTolerancePct! : 0.1,
  };
}

function numberAt(o: Record<string, unknown>, key: string): number | null {
  const v = o[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

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
