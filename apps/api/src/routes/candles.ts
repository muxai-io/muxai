import { Router } from "express";

export const candleRoutes = Router();

// GET /api/candles?symbol=BTCUSDT&interval=4h&since=<ms>&limit=200
// Thin proxy over Binance klines so the web app doesn't need to talk to
// exchanges directly. Same source the trade-resolver uses.
candleRoutes.get("/", async (req, res) => {
  const symbol = String(req.query.symbol ?? "").toUpperCase().replace(/[\/\-_\s]/g, "");
  const interval = String(req.query.interval ?? "4h");
  const since = Number(req.query.since);
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);

  if (!symbol || !interval) {
    res.status(400).json({ error: "symbol and interval are required" });
    return;
  }

  const params = new URLSearchParams({ symbol, interval, limit: String(limit) });
  if (Number.isFinite(since)) params.set("startTime", String(since));

  try {
    const upstream = await fetch(`https://api.binance.com/api/v3/klines?${params.toString()}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!upstream.ok) {
      const body = await upstream.text().catch(() => "");
      res.status(upstream.status).json({ error: `Binance ${upstream.status}`, detail: body.slice(0, 200) });
      return;
    }
    const raw = (await upstream.json()) as unknown[][];
    const candles = raw.map((k) => ({
      time: Math.floor(Number(k[0]) / 1000), // lightweight-charts wants seconds (UTCTimestamp)
      open: parseFloat(k[1] as string),
      high: parseFloat(k[2] as string),
      low: parseFloat(k[3] as string),
      close: parseFloat(k[4] as string),
      volume: parseFloat(k[5] as string),
    }));
    res.setHeader("Cache-Control", "public, max-age=30");
    res.json({ symbol, interval, candles });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to fetch candles" });
  }
});
