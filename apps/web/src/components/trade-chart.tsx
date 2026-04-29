"use client";
import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createSeriesMarkers,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type ISeriesMarkersPluginApi,
  type ISeriesPrimitive,
  type IPrimitivePaneView,
  type IPrimitivePaneRenderer,
  type PrimitivePaneViewZOrder,
  type SeriesAttachedParameter,
  type UTCTimestamp,
  type CandlestickData,
  type LineData,
  type HistogramData,
  type SeriesMarker,
  type SeriesType,
  type Time,
} from "lightweight-charts";
import { API_URL, API_KEY } from "@/lib/utils";

// Derive the canvas target type from the interface so we don't need a direct
// dependency on the `fancy-canvas` types package.
type DrawTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];

interface Props {
  symbol: string;
  interval: string;
  side: "LONG" | "SHORT";
  entry: number;
  takeProfit: number;
  stopLoss: number;
  decisionAt: number;        // ms epoch
  hitAt?: number | null;
  exitPrice?: number | null;
  outcome?: "Win" | "Loss" | "NA" | null;
  height?: number;
}

interface CandleResp {
  symbol: string;
  interval: string;
  candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[];
}

export function TradeChart({
  symbol,
  interval,
  side,
  entry,
  takeProfit,
  stopLoss,
  decisionAt,
  hitAt,
  exitPrice,
  outcome,
  height = 480,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const ema20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema200Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const positionBoxRef = useRef<PositionBoxPrimitive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Init chart + all series once ─────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: "rgba(148, 163, 184, 0.9)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        panes: { separatorColor: "rgba(148, 163, 184, 0.15)", separatorHoverColor: "rgba(148, 163, 184, 0.3)", enableResize: true },
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.08)" },
        horzLines: { color: "rgba(148, 163, 184, 0.08)" },
      },
      rightPriceScale: { borderColor: "rgba(148, 163, 184, 0.15)" },
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.15)",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: 1 },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
      borderVisible: false,
    });
    const ema20 = chart.addSeries(LineSeries, { color: "rgba(96, 165, 250, 0.85)", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const ema50 = chart.addSeries(LineSeries, { color: "rgba(251, 146, 60, 0.85)", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const ema200 = chart.addSeries(LineSeries, { color: "rgba(168, 85, 247, 0.9)", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });

    // Volume in pane 1
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      lastValueVisible: false,
      priceLineVisible: false,
    }, 1);

    chartRef.current = chart;
    seriesRef.current = candles;
    ema20Ref.current = ema20;
    ema50Ref.current = ema50;
    ema200Ref.current = ema200;
    volumeRef.current = volume;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      ema20Ref.current = null;
      ema50Ref.current = null;
      ema200Ref.current = null;
      volumeRef.current = null;
      priceLinesRef.current = [];
      markersRef.current = null;
      positionBoxRef.current = null;
    };
  }, []);

  // ── Load + redraw on input change ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const chart = chartRef.current;
      const candles = seriesRef.current;
      const ema20 = ema20Ref.current;
      const ema50 = ema50Ref.current;
      const ema200 = ema200Ref.current;
      const volume = volumeRef.current;
      if (!chart || !candles || !ema20 || !ema50 || !ema200 || !volume) return;
      setError(null);
      setLoading(true);

      const intervalMs = intervalToMs(interval);
      const since = decisionAt - intervalMs * 800;

      try {
        const url = `${API_URL}/api/candles?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&since=${since}&limit=1000`;
        const res = await fetch(url, { headers: API_KEY ? { "X-Api-Key": API_KEY } : {} });
        if (!res.ok) throw new Error(`Candles ${res.status}`);
        const body = (await res.json()) as CandleResp;
        if (cancelled) return;

        const data: CandlestickData[] = body.candles.map((c) => ({
          time: c.time as UTCTimestamp,
          open: c.open, high: c.high, low: c.low, close: c.close,
        }));
        candles.setData(data);

        // EMAs
        const closes = body.candles.map((c) => c.close);
        const e20 = computeEma(closes, 20);
        const e50 = computeEma(closes, 50);
        const e200 = computeEma(closes, 200);
        ema20.setData(toLineData(body.candles, e20));
        ema50.setData(toLineData(body.candles, e50));
        ema200.setData(toLineData(body.candles, e200));

        // Volume — green/red bars matched to candle direction
        const volData: HistogramData[] = body.candles.map((c) => ({
          time: c.time as UTCTimestamp,
          value: c.volume,
          color: c.close >= c.open ? "rgba(16, 185, 129, 0.4)" : "rgba(239, 68, 68, 0.4)",
        }));
        volume.setData(volData);

        // Tear down + recreate price lines (entry/TP/SL) — kept for axis labels.
        for (const pl of priceLinesRef.current) candles.removePriceLine(pl);
        priceLinesRef.current = [
          candles.createPriceLine({ price: entry,      color: "#94a3b8", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Entry" }),
          candles.createPriceLine({ price: takeProfit, color: "#10b981", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "TP" }),
          candles.createPriceLine({ price: stopLoss,   color: "#ef4444", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "SL" }),
        ];

        // Position box primitive — green TP zone + red SL zone, decision → exit/now.
        if (positionBoxRef.current) candles.detachPrimitive(positionBoxRef.current);
        const lastTime = data.length ? (data[data.length - 1].time as UTCTimestamp) : (Math.floor(Date.now() / 1000) as UTCTimestamp);
        // Snap to nearest bar so timeToCoordinate resolves cleanly across timeframes.
        const decisionTimeSec = snapToBar(body.candles, decisionAt);
        const exitTimeSec = (hitAt ? snapToBar(body.candles, hitAt) : lastTime) as UTCTimestamp;
        positionBoxRef.current = new PositionBoxPrimitive({
          decisionTime: decisionTimeSec,
          exitTime: exitTimeSec,
          entry, takeProfit, stopLoss,
        });
        candles.attachPrimitive(positionBoxRef.current);

        // Markers
        const markers: SeriesMarker<Time>[] = [{
          time: decisionTimeSec,
          position: side === "LONG" ? "belowBar" : "aboveBar",
          color: "#94a3b8",
          shape: side === "LONG" ? "arrowUp" : "arrowDown",
          text: side,
        }];
        if (hitAt && exitPrice !== undefined && exitPrice !== null) {
          const win = outcome === "Win";
          markers.push({
            time: Math.floor(hitAt / 1000) as UTCTimestamp,
            position: win ? "aboveBar" : "belowBar",
            color: win ? "#10b981" : outcome === "Loss" ? "#ef4444" : "#94a3b8",
            shape: win ? "arrowDown" : "arrowUp",
            text: `${outcome ?? "EXIT"} @ ${exitPrice}`,
          });
        }
        if (markersRef.current) markersRef.current.setMarkers(markers);
        else markersRef.current = createSeriesMarkers(candles as ISeriesApi<SeriesType, Time>, markers);

        // Wider default visible range — 200 bars before, 300 after the decision.
        const decSec = Math.floor(decisionAt / 1000);
        const fromSec = decSec - Math.floor((intervalMs / 1000) * 200);
        const toSec = decSec + Math.floor((intervalMs / 1000) * 300);
        chart.timeScale().setVisibleRange({ from: fromSec as UTCTimestamp, to: toSec as UTCTimestamp });

        // Pane heights — give volume ~20% so candles dominate.
        const panes = chart.panes();
        if (panes.length > 1) panes[1].setHeight(80);

        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load candles");
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, interval, entry, takeProfit, stopLoss, decisionAt, hitAt, exitPrice, outcome, side]);

  return (
    <div className="relative" style={{ height }}>
      <div ref={containerRef} className="absolute inset-0" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground pointer-events-none">
          loading candles…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-red-400">
          {error}
        </div>
      )}
      <div className="absolute top-1.5 left-2 flex items-center gap-3 text-[10px] font-mono text-muted-foreground/80 pointer-events-none">
        <LegendDot color="rgba(96, 165, 250, 0.85)" label="EMA 20" />
        <LegendDot color="rgba(251, 146, 60, 0.85)" label="EMA 50" />
        <LegendDot color="rgba(168, 85, 247, 0.9)" label="EMA 200" />
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block h-0.5 w-3" style={{ background: color }} />
      <span>{label}</span>
    </span>
  );
}

// ── Position box primitive ──────────────────────────────────────────────────
// Draws filled rectangles between decision and exit times, covering the
// entry → TP zone (green) and entry → SL zone (red) on the main pane.

interface BoxParams {
  decisionTime: UTCTimestamp;
  exitTime: UTCTimestamp;
  entry: number;
  takeProfit: number;
  stopLoss: number;
}

class PositionBoxPrimitive implements ISeriesPrimitive<Time> {
  private _params: BoxParams;
  private _paneView: PositionBoxPaneView;
  private _renderer: PositionBoxRenderer;

  constructor(params: BoxParams) {
    this._params = params;
    this._renderer = new PositionBoxRenderer(params);
    this._paneView = new PositionBoxPaneView(this._renderer);
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this._renderer.attach(param.chart, param.series);
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this._paneView];
  }

  updateAllViews(): void {
    this._renderer.update(this._params);
  }
}

class PositionBoxPaneView implements IPrimitivePaneView {
  constructor(private renderer_: PositionBoxRenderer) {}
  zOrder(): PrimitivePaneViewZOrder { return "bottom"; }
  renderer(): IPrimitivePaneRenderer { return this.renderer_; }
}

class PositionBoxRenderer implements IPrimitivePaneRenderer {
  private _params: BoxParams;
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _chart: IChartApi | null = null;

  constructor(params: BoxParams) { this._params = params; }
  update(params: BoxParams) { this._params = params; }
  attach(chart: IChartApi, series: ISeriesApi<SeriesType, Time>) {
    this._chart = chart;
    this._series = series;
  }

  draw(target: DrawTarget) {
    const series = this._series;
    const chart = this._chart;
    if (!series || !chart) return;
    const ts = chart.timeScale();
    const x1 = ts.timeToCoordinate(this._params.decisionTime);
    const x2 = ts.timeToCoordinate(this._params.exitTime);
    const yEntry = series.priceToCoordinate(this._params.entry);
    const yTp = series.priceToCoordinate(this._params.takeProfit);
    const ySl = series.priceToCoordinate(this._params.stopLoss);
    if (x1 === null || x2 === null || yEntry === null || yTp === null || ySl === null) return;

    target.useBitmapCoordinateSpace((scope: { context: CanvasRenderingContext2D; horizontalPixelRatio: number; verticalPixelRatio: number }) => {
      const { context: ctx, horizontalPixelRatio: hpr, verticalPixelRatio: vpr } = scope;
      const px1 = x1 * hpr;
      const px2 = x2 * hpr;
      const pyE = yEntry * vpr;
      const pyT = yTp * vpr;
      const pyS = ySl * vpr;
      const w = px2 - px1;

      ctx.fillStyle = "rgba(16, 185, 129, 0.12)";
      ctx.fillRect(px1, Math.min(pyE, pyT), w, Math.abs(pyE - pyT));
      ctx.fillStyle = "rgba(239, 68, 68, 0.12)";
      ctx.fillRect(px1, Math.min(pyE, pyS), w, Math.abs(pyE - pyS));
      ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
      ctx.lineWidth = 1;
      ctx.strokeRect(px1, Math.min(pyT, pyS), w, Math.abs(pyT - pyS));
    });
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function computeEma(values: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function toLineData(candles: CandleResp["candles"], values: (number | null)[]): LineData[] {
  const out: LineData[] = [];
  for (let i = 0; i < candles.length; i++) {
    const v = values[i];
    if (v === null) continue;
    out.push({ time: candles[i].time as UTCTimestamp, value: v });
  }
  return out;
}

function snapToBar(candles: CandleResp["candles"], ms: number): UTCTimestamp {
  const target = Math.floor(ms / 1000);
  if (!candles.length) return target as UTCTimestamp;
  let best = candles[0].time;
  let bestDist = Math.abs(target - best);
  for (let i = 1; i < candles.length; i++) {
    const d = Math.abs(target - candles[i].time);
    if (d < bestDist) { best = candles[i].time; bestDist = d; }
  }
  return best as UTCTimestamp;
}

function intervalToMs(interval: string): number {
  const m = interval.match(/^(\d+)([mhdwM])$/);
  if (!m) return 4 * 3600 * 1000;
  const n = parseInt(m[1], 10);
  switch (m[2]) {
    case "m": return n * 60 * 1000;
    case "h": return n * 3600 * 1000;
    case "d": return n * 86400 * 1000;
    case "w": return n * 7 * 86400 * 1000;
    case "M": return n * 30 * 86400 * 1000;
    default:  return 4 * 3600 * 1000;
  }
}
