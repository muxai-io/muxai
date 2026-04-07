#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// --- Exchanges ---------------------------------------------------------------

const EXCHANGES = {
  binance: {
    label: "Binance",
    intervals: ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"],
    async fetchCandles(symbol, interval, limit) {
      const pair = normalizeSymbol(symbol);
      const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Binance ${res.status}: ${body}`);
      }
      const raw = await res.json();
      return raw.map((k) => ({
        time: new Date(k[0]).toISOString(),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        trades: k[8],
      }));
    },
    async searchSymbols(query) {
      const url = "https://api.binance.com/api/v3/exchangeInfo";
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`Binance ${res.status}`);
      const data = await res.json();
      const q = query.toUpperCase().replace(/[\/\-]/g, "");
      if (!Array.isArray(data.symbols)) throw new Error("Unexpected response from Binance exchangeInfo");
      return data.symbols
        .filter((s) => s.status === "TRADING" && (s.symbol.includes(q) || s.baseAsset.includes(q) || s.quoteAsset.includes(q)))
        .slice(0, 20)
        .map((s) => ({ symbol: s.symbol, base: s.baseAsset, quote: s.quoteAsset }));
    },
  },

  // Bybit placeholder — wire up when ready
  // bybit: { ... },
};

const DEFAULT_EXCHANGE = "binance";

function normalizeSymbol(symbol) {
  return symbol.toUpperCase().replace(/[\/\-]/g, "");
}

function getExchange(name) {
  const key = (name || DEFAULT_EXCHANGE).toLowerCase();
  const exchange = EXCHANGES[key];
  if (!exchange) {
    const available = Object.keys(EXCHANGES).join(", ");
    throw new Error(`Unknown exchange "${name}". Available: ${available}`);
  }
  return { key, exchange };
}

// --- Indicator calculations ---------------------------------------------------

function calcSMA(closes, period) {
  const result = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    result.push(sum / period);
  }
  return result;
}

function calcEMA(closes, period) {
  const result = [];
  const k = 2 / (period + 1);
  let ema = null;
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    if (ema === null) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += closes[j];
      ema = sum / period;
    } else {
      ema = closes[i] * k + ema * (1 - k);
    }
    result.push(ema);
  }
  return result;
}

function calcRSI(closes, period = 14) {
  const result = [];
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) { result.push(null); continue; }
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    if (i < period) {
      avgGain += gain;
      avgLoss += loss;
      result.push(null);
      continue;
    }
    if (i === period) {
      avgGain = (avgGain + gain) / period;
      avgLoss = (avgLoss + loss) / period;
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - 100 / (1 + rs));
  }
  return result;
}

function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  const macdLine = closes.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null ? emaFast[i] - emaSlow[i] : null
  );
  const validMacd = macdLine.filter((v) => v !== null);
  const signalLine = calcEMA(validMacd, signal);
  // Align signal line back to full length
  const result = [];
  let si = 0;
  for (let i = 0; i < closes.length; i++) {
    if (macdLine[i] === null) {
      result.push({ macd: null, signal: null, histogram: null });
    } else {
      const sig = signalLine[si] ?? null;
      result.push({
        macd: macdLine[i],
        signal: sig,
        histogram: sig !== null ? macdLine[i] - sig : null,
      });
      si++;
    }
  }
  return result;
}

function calcBollinger(closes, period = 20, stdDev = 2) {
  const sma = calcSMA(closes, period);
  const result = [];
  for (let i = 0; i < closes.length; i++) {
    if (sma[i] === null) { result.push({ upper: null, middle: null, lower: null }); continue; }
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (closes[j] - sma[i]) ** 2;
    const std = Math.sqrt(variance / period);
    result.push({ upper: sma[i] + stdDev * std, middle: sma[i], lower: sma[i] - stdDev * std });
  }
  return result;
}

function calcATR(candles, period = 14) {
  const result = [];
  let atr = null;
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) { result.push(null); continue; }
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    if (i < period) { result.push(null); if (i === period - 1) { let sum = tr; for (let j = 1; j < period; j++) { const prev = candles[j]; const prev2 = candles[j - 1]; sum += Math.max(prev.high - prev.low, Math.abs(prev.high - prev2.close), Math.abs(prev.low - prev2.close)); } atr = sum / period; result[i] = atr; } continue; }
    atr = (atr * (period - 1) + tr) / period;
    result.push(atr);
  }
  return result;
}

function calcVWAP(candles) {
  let cumVol = 0, cumTP = 0;
  return candles.map((c) => {
    const tp = (c.high + c.low + c.close) / 3;
    cumVol += c.volume;
    cumTP += tp * c.volume;
    return cumVol > 0 ? cumTP / cumVol : null;
  });
}

function round(v, decimals = 2) {
  if (v === null || v === undefined) return null;
  return Math.round(v * 10 ** decimals) / 10 ** decimals;
}

const INDICATOR_PARSERS = {
  ema: (spec) => { const p = parseInt(spec.replace(/^ema/i, "")); return isNaN(p) ? null : { type: "ema", period: p }; },
  sma: (spec) => { const p = parseInt(spec.replace(/^sma/i, "")); return isNaN(p) ? null : { type: "sma", period: p }; },
  rsi: (spec) => { const p = parseInt(spec.replace(/^rsi/i, "")) || 14; return { type: "rsi", period: p }; },
  macd: () => ({ type: "macd" }),
  bollinger: () => ({ type: "bollinger" }),
  bb: () => ({ type: "bollinger" }),
  atr: (spec) => { const p = parseInt(spec.replace(/^atr/i, "")) || 14; return { type: "atr", period: p }; },
  vwap: () => ({ type: "vwap" }),
};

function parseIndicator(spec) {
  const lower = spec.toLowerCase().trim();
  for (const [prefix, parser] of Object.entries(INDICATOR_PARSERS)) {
    if (lower.startsWith(prefix)) return parser(lower);
  }
  return null;
}

function computeIndicators(candles, specs) {
  const closes = candles.map((c) => c.close);
  const results = {};

  for (const spec of specs) {
    const parsed = parseIndicator(spec);
    if (!parsed) { results[spec] = { error: `Unknown indicator: ${spec}` }; continue; }

    switch (parsed.type) {
      case "ema": {
        const vals = calcEMA(closes, parsed.period);
        const last = vals[vals.length - 1];
        results[spec] = { value: round(last), period: parsed.period };
        break;
      }
      case "sma": {
        const vals = calcSMA(closes, parsed.period);
        const last = vals[vals.length - 1];
        results[spec] = { value: round(last), period: parsed.period };
        break;
      }
      case "rsi": {
        const vals = calcRSI(closes, parsed.period);
        const last = vals[vals.length - 1];
        results[spec] = { value: round(last), period: parsed.period };
        break;
      }
      case "macd": {
        const vals = calcMACD(closes);
        const last = vals[vals.length - 1];
        results[spec] = { macd: round(last.macd), signal: round(last.signal), histogram: round(last.histogram) };
        break;
      }
      case "bollinger": {
        const vals = calcBollinger(closes);
        const last = vals[vals.length - 1];
        results[spec] = { upper: round(last.upper), middle: round(last.middle), lower: round(last.lower) };
        break;
      }
      case "atr": {
        const vals = calcATR(candles, parsed.period);
        const last = vals[vals.length - 1];
        results[spec] = { value: round(last), period: parsed.period };
        break;
      }
      case "vwap": {
        const vals = calcVWAP(candles);
        const last = vals[vals.length - 1];
        results[spec] = { value: round(last) };
        break;
      }
    }
  }
  return results;
}

// --- MCP server --------------------------------------------------------------

const server = new Server({ name: "crypto-ohlcv", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_candles",
      description:
        "Fetch OHLCV candlestick data for a crypto trading pair. " +
        "Returns an array of candles with open, high, low, close, volume, and timestamp. " +
        "Use this data to calculate technical indicators (EMA, RSI, MACD, Bollinger Bands, etc.), " +
        "identify support/resistance levels, and perform price action analysis. " +
        'Symbol format: "BTCUSDT" or "BTC/USDT". ' +
        "Default exchange: Binance. Default interval: 4h. Default limit: 100.",
      inputSchema: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description: 'Trading pair, e.g. "BTCUSDT", "BTC/USDT", "ETHUSDT"',
          },
          interval: {
            type: "string",
            description: 'Candlestick interval. Default "4h". Binance: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M',
            default: "4h",
          },
          limit: {
            type: "number",
            description: "Number of candles to return (1-1000). Default 100.",
            default: 100,
          },
          exchange: {
            type: "string",
            description: 'Exchange to fetch from. Default "binance". Supported: binance',
            default: "binance",
          },
        },
        required: ["symbol"],
      },
    },
    {
      name: "get_indicators",
      description:
        "Calculate technical indicators for a crypto trading pair. " +
        "Fetches candle data internally and computes the requested indicators server-side (fast, accurate, no LLM arithmetic needed). " +
        "Returns the latest value for each indicator. " +
        "Supported indicators: EMA{period} (e.g. EMA9, EMA21, EMA50, EMA200), SMA{period}, RSI (default 14), MACD, Bollinger/BB, ATR (default 14), VWAP. " +
        "Call this instead of get_candles when you only need indicator values.",
      inputSchema: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description: 'Trading pair, e.g. "BTCUSDT", "BTC/USDT"',
          },
          interval: {
            type: "string",
            description: 'Candlestick interval. Default "4h".',
            default: "4h",
          },
          indicators: {
            type: "array",
            items: { type: "string" },
            description: 'Array of indicators to calculate, e.g. ["EMA9", "EMA21", "EMA50", "RSI", "MACD", "BB", "ATR", "VWAP"]',
          },
          exchange: {
            type: "string",
            description: 'Exchange to fetch from. Default "binance".',
            default: "binance",
          },
        },
        required: ["symbol", "indicators"],
      },
    },
    {
      name: "search_symbols",
      description:
        "Search for available trading pairs on an exchange. " +
        "Use this to find the correct symbol before fetching candle data. " +
        'For example, search "SOL" to find all SOL trading pairs.',
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: 'Search query, e.g. "BTC", "ETH", "SOL"',
          },
          exchange: {
            type: "string",
            description: 'Exchange to search. Default "binance". Supported: binance',
            default: "binance",
          },
        },
        required: ["query"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "get_candles") {
    const { symbol, interval = "4h", limit = 100, exchange: exchangeName } = args;

    let key, exchange;
    try {
      ({ key, exchange } = getExchange(exchangeName));
    } catch (err) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }

    if (!exchange.intervals.includes(interval)) {
      return {
        content: [
          {
            type: "text",
            text: `Invalid interval "${interval}" for ${exchange.label}. Valid: ${exchange.intervals.join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    const clampedLimit = Math.max(1, Math.min(1000, limit));

    try {
      const candles = await exchange.fetchCandles(symbol, interval, clampedLimit);
      const first = candles[0];
      const last = candles[candles.length - 1];

      const summary = [
        `${normalizeSymbol(symbol)} ${interval} | ${exchange.label} | ${candles.length} candles`,
        `Period: ${first.time} to ${last.time}`,
        `Latest: O=${last.open} H=${last.high} L=${last.low} C=${last.close} V=${last.volume.toFixed(2)}`,
      ].join("\n");

      return {
        content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(candles)}` }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error fetching candles: ${err.message}` }],
        isError: true,
      };
    }
  }

  if (name === "get_indicators") {
    const { symbol, interval = "4h", indicators, exchange: exchangeName } = args;

    if (!indicators || indicators.length === 0) {
      return { content: [{ type: "text", text: "No indicators specified." }], isError: true };
    }

    let exchange;
    try {
      ({ exchange } = getExchange(exchangeName));
    } catch (err) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }

    if (!exchange.intervals.includes(interval)) {
      return {
        content: [{ type: "text", text: `Invalid interval "${interval}" for ${exchange.label}. Valid: ${exchange.intervals.join(", ")}` }],
        isError: true,
      };
    }

    try {
      // Fetch enough candles for indicator warmup (200 is sufficient for EMA200)
      const candles = await exchange.fetchCandles(symbol, interval, 300);
      const last = candles[candles.length - 1];
      const results = computeIndicators(candles, indicators);

      const header = `${normalizeSymbol(symbol)} ${interval} | ${exchange.label} | ${last.time}\nPrice: ${last.close}`;

      return {
        content: [{ type: "text", text: `${header}\n\n${JSON.stringify(results, null, 2)}` }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }

  if (name === "search_symbols") {
    const { query, exchange: exchangeName } = args;

    let key, exchange;
    try {
      ({ key, exchange } = getExchange(exchangeName));
    } catch (err) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }

    try {
      const results = await exchange.searchSymbols(query);
      if (results.length === 0) {
        return {
          content: [{ type: "text", text: `No trading pairs found for "${query}" on ${exchange.label}.` }],
        };
      }
      return {
        content: [{ type: "text", text: `Found ${results.length} pairs on ${exchange.label}:\n${JSON.stringify(results)}` }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error searching symbols: ${err.message}` }],
        isError: true,
      };
    }
  }

  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
