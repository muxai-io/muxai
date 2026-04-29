// Pure resolver — given a trade decision and a series of candles, decide whether
// the trade entered, hit TP, hit SL, or expired. No I/O, no DB. Deterministic.
//
// Manual overrides: `manualEntry` skips fill detection (user actually traded on
// the exchange and may have got a different fill); `manualExit` terminates the
// trade at a user-supplied price (e.g. cut early, or slippage on exit).

export type TradeSide = "LONG" | "SHORT";

export interface Candle {
  openTime: number; // ms epoch — bar open
  open: number;
  high: number;
  low: number;
  close: number;
  closeTime: number; // ms epoch — bar close
}

export interface ManualEntry { at: number; fill: number }
export interface ManualExit { at: number; price: number }

export interface ResolveInput {
  side: TradeSide;
  entry: number;
  takeProfit: number;
  stopLoss: number;
  decisionAt: number;       // ms epoch — when the trade decision was emitted
  expireBars: number;       // close as expired/NA after this many bars from decisionAt
  fillTolerancePct: number; // entry "hit" if price came within this % of entry
  candles: Candle[];        // candles AFTER decisionAt, oldest → newest
  manualEntry?: ManualEntry;
  manualExit?: ManualExit;
}

export type ResolveStatus = "pending" | "active" | "resolved" | "expired";

export interface ResolveResult {
  status: ResolveStatus;
  outcome?: "Win" | "Loss" | "NA";
  outcomeFields?: {
    source: "auto";
    r_multiple?: number;
    entry_fill?: number;
    exit_price?: number;
    bars_to_entry?: number;
    bars_to_exit?: number;
  };
  meta: {
    enteredAt?: number;
    hitAt?: number;
    barsConsidered: number;
    reason?: "tp_hit" | "sl_hit" | "same_bar_collision" | "no_fill_expired" | "no_resolution_expired" | "manual_exit";
  };
}

/**
 * Walk forward through candles after decisionAt and decide outcome.
 * Conservative rule: if a single bar's range hits both TP and SL, treat as Loss
 * (we have no intra-bar data to know which came first).
 */
export function resolveTradeFromCandles(input: ResolveInput): ResolveResult {
  const { side, entry, takeProfit, stopLoss, decisionAt, expireBars, fillTolerancePct, candles, manualEntry, manualExit } = input;

  const bars = candles.filter((c) => c.openTime >= decisionAt).slice(0, expireBars);

  // R-multiple uses the *real* fill, not the configured entry price.
  const rMul = (fill: number, exit: number): number => {
    if (side === "LONG") {
      const denom = fill - stopLoss;
      return denom > 0 ? (exit - fill) / denom : 0;
    }
    const denom = stopLoss - fill;
    return denom > 0 ? (fill - exit) / denom : 0;
  };

  // ── Step 1: establish entry ────────────────────────────────────────────────
  let enteredAt: number | undefined;
  let entryFill: number | undefined;
  let entryBarIndex = -1; // -1 means "no bar in `bars` corresponds to the entry"

  if (manualEntry) {
    enteredAt = manualEntry.at;
    entryFill = manualEntry.fill;
    const idx = bars.findIndex((c) => c.openTime >= manualEntry.at);
    entryBarIndex = idx; // may be -1 if manual entry is in the future relative to candles
  } else {
    const tolerance = entry * (fillTolerancePct / 100);
    const entryLow = entry - tolerance;
    const entryHigh = entry + tolerance;
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      if (bar.low <= entryHigh && bar.high >= entryLow) {
        enteredAt = bar.openTime;
        entryBarIndex = i;
        entryFill = clamp(entry, bar.low, bar.high);
        break;
      }
    }
  }

  // ── Step 2: manual exit short-circuit ──────────────────────────────────────
  // Only valid once entry is established (auto or manual).
  if (manualExit && enteredAt !== undefined && entryFill !== undefined) {
    const r = rMul(entryFill, manualExit.price);
    const outcome: "Win" | "Loss" | "NA" = r > 0 ? "Win" : r < 0 ? "Loss" : "NA";
    const exitBarIdx = bars.findIndex((c) => c.openTime >= manualExit.at);
    return {
      status: "resolved",
      outcome,
      outcomeFields: {
        source: "auto",
        r_multiple: round(r, 2),
        entry_fill: entryFill,
        exit_price: manualExit.price,
        ...(entryBarIndex >= 0 ? { bars_to_entry: entryBarIndex } : {}),
        ...(exitBarIdx >= 0 ? { bars_to_exit: exitBarIdx } : {}),
      },
      meta: { enteredAt, hitAt: manualExit.at, barsConsidered: bars.length, reason: "manual_exit" },
    };
  }

  // ── Step 3: no entry yet ──────────────────────────────────────────────────
  if (enteredAt === undefined || entryFill === undefined) {
    if (bars.length < expireBars) {
      return { status: "pending", meta: { barsConsidered: bars.length } };
    }
    return {
      status: "expired",
      outcome: "NA",
      outcomeFields: { source: "auto" },
      meta: { barsConsidered: bars.length, reason: "no_fill_expired" },
    };
  }

  // ── Step 4: walk for TP/SL from entry bar onward ──────────────────────────
  const walkStart = entryBarIndex >= 0 ? entryBarIndex : bars.length;
  for (let i = walkStart; i < bars.length; i++) {
    const bar = bars[i];

    // Auto entry: same-bar TP/SL leniency (entry filled mid-bar; only count
    // exits if the bar's extreme breached the level).
    if (i === entryBarIndex && !manualEntry) {
      const sameBarTp = side === "LONG" ? bar.high >= takeProfit : bar.low <= takeProfit;
      const sameBarSl = side === "LONG" ? bar.low <= stopLoss : bar.high >= stopLoss;
      if (sameBarTp && sameBarSl) return collision(entryFill, stopLoss, enteredAt, bar, i, rMul);
      if (sameBarSl) return slHit(entryFill, stopLoss, enteredAt, bar, i, rMul);
      if (sameBarTp) return tpHit(entryFill, takeProfit, enteredAt, bar, i, rMul);
      continue;
    }

    const tpHitNow = side === "LONG" ? bar.high >= takeProfit : bar.low <= takeProfit;
    const slHitNow = side === "LONG" ? bar.low <= stopLoss : bar.high >= stopLoss;
    if (tpHitNow && slHitNow) return collision(entryFill, stopLoss, enteredAt, bar, i, rMul);
    if (slHitNow) return slHit(entryFill, stopLoss, enteredAt, bar, i, rMul);
    if (tpHitNow) return tpHit(entryFill, takeProfit, enteredAt, bar, i, rMul);
  }

  // ── Step 5: entry but no resolution ───────────────────────────────────────
  if (bars.length < expireBars) {
    return { status: "active", meta: { barsConsidered: bars.length, enteredAt } };
  }

  // Expired with mark-to-market against last close.
  const lastClose = bars[bars.length - 1].close;
  const mtmR = rMul(entryFill, lastClose);
  return {
    status: "expired",
    outcome: "NA",
    outcomeFields: {
      source: "auto",
      r_multiple: round(mtmR, 2),
      entry_fill: entryFill,
      exit_price: lastClose,
      ...(entryBarIndex >= 0 ? { bars_to_entry: entryBarIndex } : {}),
      bars_to_exit: bars.length - 1,
    },
    meta: { enteredAt, barsConsidered: bars.length, reason: "no_resolution_expired" },
  };
}

function tpHit(fill: number, tp: number, enteredAt: number, bar: Candle, idx: number, rMul: (f: number, e: number) => number): ResolveResult {
  return {
    status: "resolved",
    outcome: "Win",
    outcomeFields: { source: "auto", r_multiple: round(rMul(fill, tp), 2), entry_fill: fill, exit_price: tp, bars_to_exit: idx },
    meta: { enteredAt, hitAt: bar.openTime, barsConsidered: idx + 1, reason: "tp_hit" },
  };
}

function slHit(fill: number, sl: number, enteredAt: number, bar: Candle, idx: number, rMul: (f: number, e: number) => number): ResolveResult {
  return {
    status: "resolved",
    outcome: "Loss",
    outcomeFields: { source: "auto", r_multiple: round(rMul(fill, sl), 2), entry_fill: fill, exit_price: sl, bars_to_exit: idx },
    meta: { enteredAt, hitAt: bar.openTime, barsConsidered: idx + 1, reason: "sl_hit" },
  };
}

function collision(fill: number, sl: number, enteredAt: number, bar: Candle, idx: number, rMul: (f: number, e: number) => number): ResolveResult {
  return {
    status: "resolved",
    outcome: "Loss",
    outcomeFields: { source: "auto", r_multiple: round(rMul(fill, sl), 2), entry_fill: fill, exit_price: sl, bars_to_exit: idx },
    meta: { enteredAt, hitAt: bar.openTime, barsConsidered: idx + 1, reason: "same_bar_collision" },
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round(v: number, dp: number): number {
  const m = Math.pow(10, dp);
  return Math.round(v * m) / m;
}
