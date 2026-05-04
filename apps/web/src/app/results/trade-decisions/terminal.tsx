"use client";
import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { ChevronRight, FileJson, Filter } from "lucide-react";
import type { HeartbeatRun } from "@/lib/types";
import { TradeChart } from "@/components/trade-chart";
import { MonitoringBadge } from "@/components/monitoring-badge";
import { Button } from "@/components/ui/button";
import { ResultCard } from "@/components/result-card";
import { ManualTradePanel } from "@/components/manual-trade-panel";
import { EventsStream } from "@/components/events-stream";
import { ReExamineButton } from "@/components/re-examine-button";
import { canReExamine, type ResultCardConfig } from "@/lib/result-cards";

interface Trade {
  runId: string;
  agentId: string;
  agentName: string;
  asset: string;             // raw e.g. "BTC/USDT"
  symbol: string;            // normalized e.g. "BTCUSDT"
  timeframe: string;
  side: "LONG" | "SHORT" | "WAIT";
  entry: number | null;
  takeProfit: number | null;
  stopLoss: number | null;
  decisionAt: number | null; // ms
  resolutionStatus: HeartbeatRun["resolutionStatus"];
  outcome: string | null;
  outcomeFields: Record<string, unknown> | null;
  resolutionMeta: Record<string, unknown> | null;
  rMultiple: number | null;
  hitAt: number | null;
  exitPrice: number | null;
  createdAt: string;
  // Latest re-examination of this trade, if any
  latestReExamination: { runId: string; convictionScore: number | null; suggestedAction: string | null; at: number } | null;
  rawRun: HeartbeatRun;
}

type Window = "24h" | "7d" | "all";
type StatusFilter = "all" | "active" | "closed";
type SideFilter = "all" | "LONG" | "SHORT" | "WAIT";

export function ResultsTerminal({ runs }: { runs: HeartbeatRun[] }) {
  const [windowSel, setWindowSel] = useState<Window>("7d");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sideFilter, setSideFilter] = useState<SideFilter>("all");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // Build a map of parent runId -> latest re-examination so we can surface
  // the most recent conviction score on the parent trade row.
  const latestReExamByParent = useMemo(() => {
    const map = new Map<string, Trade["latestReExamination"]>();
    for (const r of runs) {
      if (!r.parentRunId) continue;
      const result = (r.resultJson ?? {}) as Record<string, unknown>;
      const at = r.finishedAt ? new Date(r.finishedAt).getTime() : new Date(r.createdAt).getTime();
      const candidate: NonNullable<Trade["latestReExamination"]> = {
        runId: r.id,
        convictionScore: typeof result.conviction_score === "number" ? result.conviction_score : null,
        suggestedAction: typeof result.suggested_action === "string" ? result.suggested_action : null,
        at,
      };
      const existing = map.get(r.parentRunId);
      if (!existing || candidate.at > existing.at) map.set(r.parentRunId, candidate);
    }
    return map;
  }, [runs]);

  // Set of parent runIds whose re-examination is currently in flight.
  // Used to disable the Re-examine button so we don't double-fire.
  const reExamRunningByParent = useMemo(() => {
    const set = new Set<string>();
    for (const r of runs) {
      if (!r.parentRunId) continue;
      if (r.status === "running" || r.status === "queued") set.add(r.parentRunId);
    }
    return set;
  }, [runs]);

  // Trades = parent runs only (re-examination runs are not standalone trades;
  // their conviction is surfaced on the parent row instead).
  const trades = useMemo(
    () => runs.filter((r) => !r.parentRunId).map((r) => toTrade(r, latestReExamByParent.get(r.id) ?? null)),
    [runs, latestReExamByParent],
  );
  // Show every parent run from a trade-decision agent — including WAIT (no levels).
  // Non-trade-decision agents are filtered out so the chart pane stays meaningful.
  const tradeDecisionTrades = useMemo(
    () => trades.filter((t) => isTradeDecisionAgent(t.rawRun)),
    [trades],
  );

  const windowed = useMemo(() => {
    if (windowSel === "all") return tradeDecisionTrades;
    const cutoff = Date.now() - (windowSel === "24h" ? 24 : 24 * 7) * 3600 * 1000;
    return tradeDecisionTrades.filter((t) => new Date(t.createdAt).getTime() >= cutoff);
  }, [tradeDecisionTrades, windowSel]);

  const filtered = useMemo(() => {
    return windowed.filter((t) => {
      if (statusFilter === "active") {
        if (t.resolutionStatus !== "pending" && t.resolutionStatus !== "active") return false;
      } else if (statusFilter === "closed") {
        if (t.resolutionStatus !== "resolved" && t.resolutionStatus !== "expired") return false;
      }
      if (sideFilter !== "all" && t.side !== sideFilter) return false;
      return true;
    });
  }, [windowed, statusFilter, sideFilter]);

  const stats = useMemo(() => computeStats(windowed), [windowed]);

  // Auto-select the first row whenever the filtered list changes and current selection isn't in it
  useEffect(() => {
    if (!filtered.length) {
      setSelectedRunId(null);
      return;
    }
    if (!filtered.some((t) => t.runId === selectedRunId)) {
      setSelectedRunId(filtered[0].runId);
    }
  }, [filtered, selectedRunId]);

  const selected = filtered.find((t) => t.runId === selectedRunId) ?? null;

  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-24 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
          <FileJson className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium">No results yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Results appear when an agent outputs a JSON block at the end of a run
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Aggregate strip */}
      <div className="rounded-lg border border-border bg-card/60 px-4 py-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-5 flex-wrap">
            <Stat label="Active" value={String(stats.active)} tone="amber" />
            <Stat label="Closed" value={String(stats.closed)} />
            <Stat label="Cum. R" value={fmtR(stats.cumR)} tone={stats.cumR > 0 ? "emerald" : stats.cumR < 0 ? "red" : "default"} />
            <Stat label="Hit rate" value={stats.hitRate !== null ? `${Math.round(stats.hitRate * 100)}%` : "—"} />
            <Stat label="Profit factor" value={stats.profitFactor !== null ? stats.profitFactor.toFixed(2) : "—"} />
          </div>
          <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
            {(["24h", "7d", "all"] as Window[]).map((w) => (
              <button
                key={w}
                onClick={() => setWindowSel(w)}
                className={`px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider rounded-sm transition-colors ${
                  windowSel === w ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Three-pane: blotter + chart + events sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Blotter — 3 cols */}
        <div className="lg:col-span-3 space-y-2">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
            <Filter className="h-3 w-3" />
            <span>Filters</span>
          </div>
          <FilterRow value={statusFilter} options={["all", "active", "closed"]} onChange={(v) => setStatusFilter(v as StatusFilter)} />
          <FilterRow value={sideFilter} options={["all", "LONG", "SHORT", "WAIT"]} onChange={(v) => setSideFilter(v as SideFilter)} />

          <div className="rounded-lg border border-border bg-card/40 max-h-[640px] overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                No trades match these filters.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((t) => (
                  <li key={t.runId}>
                    <button
                      onClick={() => setSelectedRunId(t.runId)}
                      className={`w-full text-left px-3 py-2.5 transition-colors ${
                        selectedRunId === t.runId ? "bg-foreground/[0.04]" : "hover:bg-foreground/[0.02]"
                      }`}
                    >
                      <BlotterRow trade={t} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Chart pane — 6 cols */}
        <div className="lg:col-span-6 space-y-2">
          {selected ? (
            <ChartPane trade={selected} reExamRunning={reExamRunningByParent.has(selected.runId)} />
          ) : (
            <ChartEmpty />
          )}
        </div>

        {/* Events sidebar — 3 cols, asset-filtered to selected trade (or BTC fallback) */}
        <div className="lg:col-span-3 space-y-2">
          <EventsStream
            density="compact"
            asset={selected ? (selected.asset.split(/[\/\-_\s]/)[0]?.toUpperCase() || undefined) : undefined}
          />
        </div>
      </div>
    </div>
  );
}

function FilterRow({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-border p-0.5 w-fit">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded-sm transition-colors ${
            value === opt ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function BlotterRow({ trade }: { trade: Trade }) {
  const sideColor =
    trade.side === "LONG" ? "text-emerald-400" : trade.side === "SHORT" ? "text-red-400" : "text-amber-400";
  const reExam = trade.latestReExamination;
  const convictionTone = reExam?.convictionScore == null
    ? "text-muted-foreground"
    : reExam.convictionScore >= 70 ? "text-emerald-400"
    : reExam.convictionScore >= 40 ? "text-amber-400"
    : "text-red-400";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-mono font-medium truncate">{trade.asset}</span>
          <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${sideColor}`}>{trade.side}</span>
          <span className="text-[10px] font-mono text-muted-foreground">{trade.timeframe}</span>
        </div>
        <span className="text-[10px] text-muted-foreground shrink-0">{relativeTime(trade.createdAt)}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-mono text-muted-foreground truncate">
          {trade.entry !== null && <span>e {fmt(trade.entry)}</span>}
          {trade.takeProfit !== null && <span> · tp {fmt(trade.takeProfit)}</span>}
          {trade.stopLoss !== null && <span> · sl {fmt(trade.stopLoss)}</span>}
        </div>
        <MonitoringBadge run={trade.rawRun} compact />
      </div>
      {reExam && reExam.convictionScore !== null && (
        <div className="flex items-center gap-1.5 text-[10px] font-mono">
          <span className="text-muted-foreground/70 uppercase tracking-wider">conv</span>
          <span className={`font-semibold ${convictionTone}`}>{reExam.convictionScore}</span>
          {reExam.suggestedAction && (
            <span className="text-muted-foreground uppercase tracking-wider">· {reExam.suggestedAction}</span>
          )}
        </div>
      )}
    </div>
  );
}

const TIMEFRAMES = ["15m", "30m", "1h", "4h", "1d"] as const;
type Timeframe = typeof TIMEFRAMES[number];

function ChartPane({ trade, reExamRunning }: { trade: Trade; reExamRunning: boolean }) {
  const cardConfig = (trade.rawRun.agent?.adapterConfig as Record<string, unknown> | undefined)?.resultCard as ResultCardConfig | undefined;
  const [cardOpen, setCardOpen] = useState(true);
  const [markOpen, setMarkOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const initialTf = (TIMEFRAMES as readonly string[]).includes(trade.timeframe) ? (trade.timeframe as Timeframe) : "4h";
  const [chartInterval, setChartInterval] = useState<Timeframe>(initialTf);
  const hasLevels =
    trade.side !== "WAIT" &&
    trade.entry !== null &&
    trade.takeProfit !== null &&
    trade.stopLoss !== null &&
    trade.decisionAt !== null;

  // Side-tint shared by the outer container and (via embedded mode) the result card,
  // so the panel reads as one cohesive surface rather than nested cards.
  const sideTint =
    trade.side === "LONG" ? "bg-emerald-500/[0.04]"
    : trade.side === "SHORT" ? "bg-red-500/[0.04]"
    : "bg-amber-500/[0.04]";
  // Stronger tint for the result card section so the trade thesis reads as the
  // colorful focal point while the rest of the pane stays supporting.
  const cardTint =
    trade.side === "LONG" ? "bg-emerald-500/10"
    : trade.side === "SHORT" ? "bg-red-500/10"
    : "bg-amber-500/10";
  const sectionBorder = "border-foreground/[0.06]";
  const showMark = (trade.resolutionStatus === "pending" || trade.resolutionStatus === "active") && isAutoResolveEnabled(trade.rawRun);

  return (
    <div className={`rounded-lg overflow-hidden ${sideTint}`}>
      <div className={`flex items-center justify-between px-4 py-2.5 border-b ${sectionBorder}`}>
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          <span className="text-sm font-mono font-semibold">{trade.asset}</span>
          <span className="text-[11px] font-mono text-muted-foreground">{trade.timeframe}</span>
          <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${trade.side === "LONG" ? "text-emerald-400" : trade.side === "SHORT" ? "text-red-400" : "text-amber-400"}`}>{trade.side}</span>
          <MonitoringBadge run={trade.rawRun} />
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {canReExamine("trade-decision", trade.resolutionStatus) && (
            <ReExamineButton parentRunId={trade.runId} mode="stay" running={reExamRunning} />
          )}
          <Button asChild size="sm" variant="ghost" className="h-7 gap-1 text-xs">
            <Link href={`/agents/${trade.agentId}/runs/${trade.runId}`}>
              View run <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>
      {trade.latestReExamination && trade.latestReExamination.convictionScore !== null && (
        <ConvictionBanner
          score={trade.latestReExamination.convictionScore}
          suggestedAction={trade.latestReExamination.suggestedAction}
          href={`/agents/${trade.agentId}/runs/${trade.latestReExamination.runId}`}
          borderClass={sectionBorder}
        />
      )}

      {/* Result card — shown first so the trade thesis sits at the top */}
      {trade.rawRun.resultJson && (
        <div className={`border-t ${sectionBorder} ${cardTint}`}>
          <button
            onClick={() => setCardOpen((o) => !o)}
            className="w-full flex items-center justify-between px-4 py-2 text-left text-[11px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>{cardOpen ? "▾" : "▸"} Result card</span>
          </button>
          {cardOpen && (
            <div className="px-4 pb-4">
              {cardConfig && cardConfig.type !== "none" && cardConfig.type !== "raw" ? (
                <ResultCard config={cardConfig} data={trade.rawRun.resultJson} embedded />
              ) : (
                <pre className="text-xs font-mono text-foreground/80 bg-muted/40 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(trade.rawRun.resultJson, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* Mark entered / exited — collapsible, only when auto-resolve is open */}
      {showMark && (
        <div className={`border-t ${sectionBorder}`}>
          <button
            onClick={() => setMarkOpen((o) => !o)}
            className="w-full flex items-center justify-between px-4 py-2 text-left text-[11px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>{markOpen ? "▾" : "▸"} Mark {trade.resolutionStatus === "pending" ? "entered" : "entered / exited"}</span>
          </button>
          {markOpen && (
            <div className="px-3 pb-3">
              {trade.resolutionStatus === "pending" ? (
                <ManualTradePanel
                  runId={trade.runId}
                  mode="entry"
                  defaultPrice={trade.entry}
                  hint="Price is close but didn't quite tag the level — record the actual fill you got."
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <ManualTradePanel
                    runId={trade.runId}
                    mode="entry"
                    defaultPrice={trade.entry}
                    hint="Adjust the fill price if you got slippage on entry."
                  />
                  <ManualTradePanel
                    runId={trade.runId}
                    mode="exit"
                    defaultPrice={trade.takeProfit}
                    hint="Cutting early or filled with slippage? Record the real exit."
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Chart */}
      <div className={`border-t ${sectionBorder}`}>
        <div className="flex items-center justify-between px-4 py-2 gap-3">
          <button
            onClick={() => setChartOpen((o) => !o)}
            className="flex-1 text-left text-[11px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>{chartOpen ? "▾" : "▸"} Chart {hasLevels ? <span className="ml-1 normal-case tracking-normal text-[11px] text-muted-foreground/60">— entry / TP / SL on candles</span> : <span className="ml-1 normal-case tracking-normal text-[11px] text-muted-foreground/60">— no levels (WAIT)</span>}</span>
          </button>
          {chartOpen && hasLevels && (
            <div className="flex items-center gap-1 rounded-md border border-border p-0.5 shrink-0">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  onClick={() => setChartInterval(tf)}
                  className={`px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded-sm transition-colors ${
                    chartInterval === tf ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          )}
        </div>
        {chartOpen && (
          <div className="px-2 pb-3">
            {hasLevels ? (
              <TradeChart
                symbol={trade.symbol}
                interval={chartInterval}
                side={trade.side as "LONG" | "SHORT"}
                entry={trade.entry!}
                takeProfit={trade.takeProfit!}
                stopLoss={trade.stopLoss!}
                decisionAt={trade.decisionAt!}
                hitAt={trade.hitAt}
                exitPrice={trade.exitPrice}
                outcome={trade.outcome as "Win" | "Loss" | "NA" | null}
              />
            ) : (
              <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">
                No tradable levels on this decision (likely WAIT)
              </div>
            )}
          </div>
        )}
      </div>

      {/* Decision JSON */}
      {trade.rawRun.resultJson && (
        <div className={`border-t ${sectionBorder}`}>
          <button
            onClick={() => setJsonOpen((o) => !o)}
            className="w-full flex items-center justify-between px-4 py-2 text-left text-[11px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>
              {jsonOpen ? "▾" : "▸"} Decision JSON
              {cardConfig?.type && cardConfig.type !== "raw" && cardConfig.type !== "none" && (
                <span className="ml-2 normal-case tracking-normal text-muted-foreground/60">{cardConfig.type}</span>
              )}
            </span>
          </button>
          {jsonOpen && (
            <pre className="px-4 pb-3 text-[11px] font-mono whitespace-pre-wrap break-all text-muted-foreground/90">
              {JSON.stringify(trade.rawRun.resultJson, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function ConvictionBanner({
  score,
  suggestedAction,
  href,
  borderClass,
}: {
  score: number;
  suggestedAction: string | null;
  href: string;
  borderClass: string;
}) {
  // Score drives both the value tone and the gradient weighting so a low score
  // reads visibly red, mid amber, high green — without losing the spectrum cue.
  const tone =
    score >= 70 ? "text-emerald-300"
    : score >= 40 ? "text-amber-300"
    : "text-red-300";
  // Marker position along the red→amber→emerald spectrum.
  const markerPct = Math.max(0, Math.min(100, score));
  return (
    <div
      className={`border-t ${borderClass} px-4 py-3 bg-gradient-to-r from-red-500/15 via-amber-500/12 to-emerald-500/15`}
    >
      <div className="flex items-center gap-3 text-xs flex-wrap">
        <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-foreground/60">Latest conviction</span>
        <span className={`font-mono font-bold text-base ${tone}`}>{score}</span>
        {suggestedAction && (
          <span className="text-[10px] font-mono uppercase tracking-wider text-foreground/70">
            · suggests {suggestedAction}
          </span>
        )}
        <Link href={href} className="text-[11px] text-blue-300 hover:text-blue-200 hover:underline ml-auto">
          View re-examination →
        </Link>
      </div>
      {/* Slim spectrum bar with a marker showing where this conviction sits */}
      <div className="relative mt-2 h-1 rounded-full bg-gradient-to-r from-red-500/60 via-amber-500/60 to-emerald-500/60 overflow-visible">
        <div
          className="absolute -top-0.5 h-2 w-0.5 bg-foreground/80 rounded-full shadow"
          style={{ left: `calc(${markerPct}% - 1px)` }}
        />
      </div>
    </div>
  );
}

function ChartEmpty() {
  return (
    <div className="rounded-lg border border-dashed border-border h-[480px] flex items-center justify-center text-xs text-muted-foreground">
      Pick a trade from the blotter to chart it
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "amber" | "emerald" | "red" | "default" }) {
  const valueClass =
    tone === "amber" ? "text-amber-400" :
    tone === "emerald" ? "text-emerald-400" :
    tone === "red" ? "text-red-400" :
    "text-foreground";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
      <span className={`text-base font-mono font-semibold ${valueClass}`}>{value}</span>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isTradeDecisionAgent(run: HeartbeatRun): boolean {
  const adapter = (run.agent?.adapterConfig ?? {}) as Record<string, unknown>;
  const card = adapter.resultCard as { type?: string } | undefined;
  return card?.type === "trade-decision";
}

function isAutoResolveEnabled(run: HeartbeatRun): boolean {
  const adapter = (run.agent?.adapterConfig ?? {}) as Record<string, unknown>;
  const card = adapter.resultCard as { type?: string; autoResolve?: { enabled?: boolean } } | undefined;
  if (!card || card.type !== "trade-decision") return false;
  return card.autoResolve?.enabled !== false;
}

function toTrade(run: HeartbeatRun, latestReExamination: Trade["latestReExamination"]): Trade {
  const result = (run.resultJson ?? {}) as Record<string, unknown>;
  const adapter = (run.agent?.adapterConfig ?? {}) as Record<string, unknown>;
  const card = adapter.resultCard as { type?: string; mapping?: Record<string, string> } | undefined;
  const mapping = card?.mapping ?? {};
  const get = (key: string) => result[(mapping[key] || key)];
  const sideRaw = String(get("decision") ?? "").toUpperCase();
  const side: Trade["side"] = sideRaw === "LONG" || sideRaw === "SHORT" || sideRaw === "WAIT" ? sideRaw : "WAIT";
  const asset = String(get("asset") ?? "—");
  const symbol = asset.toUpperCase().replace(/[\/\-_\s]/g, "");
  const timeframe = String(get("timeframe") ?? "4h");
  const entry = num(get("entry"));
  const takeProfit = num(get("take_profit"));
  const stopLoss = num(get("stop_loss"));

  const fields = (run.outcomeFields ?? {}) as Record<string, unknown>;
  const meta = (run.resolutionMeta ?? {}) as Record<string, unknown>;
  const rMultiple = typeof fields.r_multiple === "number" ? fields.r_multiple : null;
  const hitAt = typeof meta.hitAt === "number" ? meta.hitAt : null;
  const exitPrice = typeof fields.exit_price === "number" ? fields.exit_price : null;

  // Prefer the user-recorded actual fill over the planned entry. Manual entry
  // overrides decide where the position box and entry line are drawn.
  const manualEntry = meta.manualEntry && typeof meta.manualEntry === "object"
    ? meta.manualEntry as { fill?: number }
    : null;
  const effectiveEntry = typeof manualEntry?.fill === "number"
    ? manualEntry.fill
    : typeof fields.entry_fill === "number" ? fields.entry_fill : entry;

  const decisionAt = run.finishedAt ? new Date(run.finishedAt).getTime() : run.createdAt ? new Date(run.createdAt).getTime() : null;

  return {
    runId: run.id,
    agentId: run.agentId,
    agentName: run.agent?.name ?? "—",
    asset,
    symbol,
    timeframe,
    side,
    entry: effectiveEntry,
    takeProfit,
    stopLoss,
    decisionAt,
    resolutionStatus: run.resolutionStatus,
    outcome: run.outcome,
    outcomeFields: run.outcomeFields,
    resolutionMeta: run.resolutionMeta,
    rMultiple,
    hitAt,
    exitPrice,
    createdAt: run.createdAt,
    latestReExamination,
    rawRun: run,
  };
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function fmt(n: number): string {
  if (n >= 10000) return n.toFixed(0);
  if (n >= 100) return n.toFixed(1);
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

function fmtR(r: number): string {
  return `${r >= 0 ? "+" : ""}${r.toFixed(2)}R`;
}

function relativeTime(iso: string): string {
  const dt = Date.now() - new Date(iso).getTime();
  if (dt < 60_000) return "just now";
  const m = Math.floor(dt / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function computeStats(trades: Trade[]): {
  active: number;
  closed: number;
  cumR: number;
  hitRate: number | null;
  profitFactor: number | null;
} {
  let active = 0;
  let closed = 0;
  let cumR = 0;
  let wins = 0;
  let resolvedCount = 0;
  let grossWin = 0;
  let grossLoss = 0;

  for (const t of trades) {
    if (t.resolutionStatus === "pending" || t.resolutionStatus === "active") active++;
    if (t.resolutionStatus === "resolved" || t.resolutionStatus === "expired") {
      closed++;
      if (t.rMultiple !== null) {
        cumR += t.rMultiple;
        if (t.outcome === "Win") {
          wins++;
          resolvedCount++;
          grossWin += t.rMultiple;
        } else if (t.outcome === "Loss") {
          resolvedCount++;
          grossLoss += Math.abs(t.rMultiple);
        }
      }
    }
  }

  const hitRate = resolvedCount > 0 ? wins / resolvedCount : null;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null;

  return { active, closed, cumR, hitRate, profitFactor: profitFactor === Infinity ? null : profitFactor };
}
