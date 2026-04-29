// Trade-resolver background tick. Runs every TICK_MS and resolves any
// open trade-decision runs against fresh exchange candles.

import { prisma } from "../lib/db";
import { resolveTradeFromCandles, type Candle, type TradeSide } from "./trade-resolver";
import { reportTick } from "./scheduler-registry";

const TICK_MS = 60_000;
const SCHEDULER_ID = "trade-resolver";
const SCHEDULER_LABEL = "Trade Resolver";
const SCHEDULER_SCHEDULE = "60s";

let timer: NodeJS.Timeout | null = null;
let inFlight = false;

interface AutoResolveCfg {
  enabled?: boolean;
  exchange?: string;
  expireBars?: number;
  fillTolerancePct?: number;
}

interface ResultCardCfg {
  type?: string;
  mapping?: Record<string, string>;
  autoResolve?: AutoResolveCfg;
}

const DEFAULT_EXPIRE_BARS = 24;
const DEFAULT_TOLERANCE = 0.1;
const DEFAULT_EXCHANGE = "binance";

function getCardCfg(adapterConfig: unknown): ResultCardCfg | null {
  if (!adapterConfig || typeof adapterConfig !== "object") return null;
  const card = (adapterConfig as Record<string, unknown>).resultCard;
  if (!card || typeof card !== "object") return null;
  return card as ResultCardCfg;
}

function getMappedField(mapping: Record<string, string> | undefined, slotKey: string): string {
  return mapping?.[slotKey]?.trim() || slotKey;
}

function readNumber(json: Record<string, unknown>, key: string): number | null {
  const v = json[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function readSide(json: Record<string, unknown>, key: string): TradeSide | "WAIT" | null {
  const v = json[key];
  if (typeof v !== "string") return null;
  const norm = v.trim().toUpperCase();
  if (norm === "LONG" || norm === "SHORT" || norm === "WAIT") return norm;
  return null;
}

interface OpenTrade {
  runId: string;
  agentId: string;
  side: TradeSide;
  entry: number;
  takeProfit: number;
  stopLoss: number;
  decisionAt: number;
  asset: string;
  timeframe: string;
  exchange: string;
  expireBars: number;
  fillTolerancePct: number;
  resolutionStatus: string | null;
  resolutionMeta: Record<string, unknown> | null;
  manualEntry?: { at: number; fill: number };
  manualExit?: { at: number; price: number };
}

function readManualEntry(meta: Record<string, unknown> | null): { at: number; fill: number } | undefined {
  const m = meta?.manualEntry;
  if (!m || typeof m !== "object") return undefined;
  const obj = m as Record<string, unknown>;
  const at = typeof obj.at === "number" ? obj.at : null;
  const fill = typeof obj.fill === "number" ? obj.fill : null;
  if (at === null || fill === null) return undefined;
  return { at, fill };
}

function readManualExit(meta: Record<string, unknown> | null): { at: number; price: number } | undefined {
  const m = meta?.manualExit;
  if (!m || typeof m !== "object") return undefined;
  const obj = m as Record<string, unknown>;
  const at = typeof obj.at === "number" ? obj.at : null;
  const price = typeof obj.price === "number" ? obj.price : null;
  if (at === null || price === null) return undefined;
  return { at, price };
}

async function findOpenTrades(): Promise<OpenTrade[]> {
  // Pull candidate runs whose resolution is incomplete and whose agent uses
  // a trade-decision card. Filtering on JSON inside Postgres is awkward via
  // Prisma; we filter app-side which is fine at the volumes muxAI runs at.
  const rows = await prisma.heartbeatRun.findMany({
    where: {
      OR: [{ resolutionStatus: null }, { resolutionStatus: { in: ["pending", "active"] } }],
      resultJson: { not: undefined },
      finishedAt: { not: null },
    },
    select: {
      id: true,
      agentId: true,
      finishedAt: true,
      resultJson: true,
      resolutionStatus: true,
      resolutionMeta: true,
      agent: { select: { adapterConfig: true } },
    },
    orderBy: { finishedAt: "desc" },
    take: 200,
  });

  const out: OpenTrade[] = [];
  for (const r of rows) {
    const card = getCardCfg(r.agent?.adapterConfig);
    if (!card || card.type !== "trade-decision") continue;
    const auto = card.autoResolve;
    if (auto?.enabled === false) continue;

    const result = r.resultJson as Record<string, unknown> | null;
    if (!result || typeof result !== "object") continue;
    const mapping = card.mapping;
    const decisionKey = getMappedField(mapping, "decision");
    const side = readSide(result, decisionKey);
    if (!side || side === "WAIT") continue;

    const entry = readNumber(result, getMappedField(mapping, "entry"));
    const tp = readNumber(result, getMappedField(mapping, "take_profit"));
    const sl = readNumber(result, getMappedField(mapping, "stop_loss"));
    if (entry === null || tp === null || sl === null) continue;
    if (side === "LONG" && (tp <= entry || sl >= entry)) continue;
    if (side === "SHORT" && (tp >= entry || sl <= entry)) continue;

    const asset = (result[getMappedField(mapping, "asset")] as string | undefined) ?? null;
    const timeframe = (result[getMappedField(mapping, "timeframe")] as string | undefined) ?? "4h";
    if (!asset || typeof asset !== "string") continue;

    const meta = (r.resolutionMeta ?? null) as Record<string, unknown> | null;
    out.push({
      runId: r.id,
      agentId: r.agentId,
      side,
      entry,
      takeProfit: tp,
      stopLoss: sl,
      decisionAt: r.finishedAt!.getTime(),
      asset,
      timeframe,
      exchange: auto?.exchange || DEFAULT_EXCHANGE,
      expireBars: auto?.expireBars || DEFAULT_EXPIRE_BARS,
      fillTolerancePct: typeof auto?.fillTolerancePct === "number" ? auto.fillTolerancePct : DEFAULT_TOLERANCE,
      resolutionStatus: r.resolutionStatus,
      resolutionMeta: meta,
      manualEntry: readManualEntry(meta),
      manualExit: readManualExit(meta),
    });
  }
  return out;
}

function normalizeBinanceSymbol(asset: string): string {
  return asset.toUpperCase().replace(/[\/\-_\s]/g, "");
}

async function fetchBinanceKlines(symbol: string, interval: string, sinceMs: number, expireBars: number): Promise<Candle[]> {
  // Binance klines: oldest → newest; pull a chunk that covers [sinceMs, now]
  // and is at most expireBars long.
  const limit = Math.min(Math.max(expireBars + 2, 5), 500);
  const url = `https://api.binance.com/api/v3/klines?symbol=${normalizeBinanceSymbol(symbol)}&interval=${interval}&startTime=${sinceMs}&limit=${limit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Binance ${res.status}`);
  const raw = (await res.json()) as unknown[][];
  return raw.map((k) => ({
    openTime: Number(k[0]),
    open: parseFloat(k[1] as string),
    high: parseFloat(k[2] as string),
    low: parseFloat(k[3] as string),
    close: parseFloat(k[4] as string),
    closeTime: Number(k[6]),
  }));
}

async function tickOnce(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  reportTick(SCHEDULER_ID, { status: "running", lastTickAt: new Date() });
  try {
    const trades = await findOpenTrades();
    if (trades.length === 0) {
      reportTick(SCHEDULER_ID, { status: "idle", meta: { open: 0, resolvedThisTick: 0 } });
      return;
    }

    // Group by (exchange, symbol, timeframe) — one fetch per group.
    const groups = new Map<string, OpenTrade[]>();
    for (const t of trades) {
      const key = `${t.exchange}|${normalizeBinanceSymbol(t.asset)}|${t.timeframe}`;
      const list = groups.get(key) ?? [];
      list.push(t);
      groups.set(key, list);
    }

    let resolvedCount = 0;
    let activeCount = 0;
    let errorCount = 0;

    for (const [key, list] of groups) {
      const [exchange, symbol, interval] = key.split("|");
      if (exchange !== "binance") continue; // only binance wired today
      const earliest = Math.min(...list.map((t) => t.decisionAt));
      let candles: Candle[];
      try {
        candles = await fetchBinanceKlines(symbol, interval, earliest, Math.max(...list.map((t) => t.expireBars)));
      } catch (err) {
        errorCount++;
        console.error(`[trade-resolver] fetch failed for ${key}:`, err instanceof Error ? err.message : err);
        continue;
      }

      for (const trade of list) {
        const tradeCandles = candles.filter((c) => c.openTime >= trade.decisionAt);
        const result = resolveTradeFromCandles({
          side: trade.side,
          entry: trade.entry,
          takeProfit: trade.takeProfit,
          stopLoss: trade.stopLoss,
          decisionAt: trade.decisionAt,
          expireBars: trade.expireBars,
          fillTolerancePct: trade.fillTolerancePct,
          candles: tradeCandles,
          manualEntry: trade.manualEntry,
          manualExit: trade.manualExit,
        });

        const isFinal = result.status === "resolved" || result.status === "expired";
        if (isFinal) resolvedCount++;
        else if (result.status === "active") activeCount++;

        // Preserve manual overrides across writes — `result.meta` doesn't include them.
        const nextMeta: Record<string, unknown> = { ...(result.meta as Record<string, unknown>) };
        if (trade.manualEntry) nextMeta.manualEntry = trade.manualEntry;
        if (trade.manualExit) nextMeta.manualExit = trade.manualExit;

        await prisma.heartbeatRun.update({
          where: { id: trade.runId },
          data: {
            resolutionStatus: result.status,
            resolutionCheckedAt: new Date(),
            resolutionMeta: nextMeta as object,
            ...(isFinal
              ? {
                  outcome: result.outcome,
                  ...(result.outcomeFields ? { outcomeFields: result.outcomeFields as object } : {}),
                  outcomeAt: new Date(),
                }
              : {}),
          },
        });
      }
    }

    reportTick(SCHEDULER_ID, {
      status: errorCount > 0 ? "error" : "idle",
      lastError: errorCount > 0 ? `${errorCount} fetch group(s) failed` : undefined,
      meta: { open: trades.length, resolvedThisTick: resolvedCount, activeThisTick: activeCount },
    });
  } catch (err) {
    console.error("[trade-resolver] tick failed:", err);
    reportTick(SCHEDULER_ID, { status: "error", lastError: err instanceof Error ? err.message : String(err) });
  } finally {
    inFlight = false;
  }
}

export function initTradeResolver(): void {
  reportTick(SCHEDULER_ID, {
    kind: "trade-resolver",
    label: SCHEDULER_LABEL,
    schedule: SCHEDULER_SCHEDULE,
    status: "idle",
  });
  // First tick after a short delay so boot is clean.
  setTimeout(() => { tickOnce().catch(() => {}); }, 5_000);
  timer = setInterval(() => { tickOnce().catch(() => {}); }, TICK_MS);
  if (timer.unref) timer.unref();
  console.log("[trade-resolver] initialised — tick every 60s");
}

export function stopTradeResolver(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
