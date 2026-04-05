#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// --- Helpers -----------------------------------------------------------------

function normalizeSymbol(symbol) {
  return symbol.toUpperCase().replace(/[\/\-]/g, "");
}

function fmtNum(n, decimals = 2) {
  return n.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

async function binanceFutures(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `https://fapi.binance.com${path}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Binance Futures ${res.status}: ${body}`);
  }
  return res.json();
}

function pctChange(current, previous) {
  if (!previous || previous === 0) return null;
  return parseFloat(((current - previous) / previous * 100).toFixed(2));
}

function findClosest(entries, targetTime) {
  let closest = null;
  let minDiff = Infinity;
  for (const e of entries) {
    const diff = Math.abs(e.timestamp - targetTime);
    if (diff < minDiff) {
      minDiff = diff;
      closest = e;
    }
  }
  return closest;
}

// --- MCP server --------------------------------------------------------------

const server = new Server(
  { name: "crypto-data", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_funding_rate",
      description:
        "Get the current funding rate for a crypto futures trading pair. " +
        "Returns the current rate, mark price, index price, and next funding time. " +
        "Funding rates indicate market sentiment: positive = longs pay shorts (bullish bias), " +
        "negative = shorts pay longs (bearish bias). " +
        "Extremely high or low rates often precede reversals. " +
        'Symbol format: "BTCUSDT" or "BTC/USDT". Exchange: Binance Futures.',
      inputSchema: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description: 'Futures trading pair, e.g. "BTCUSDT", "BTC/USDT", "ETHUSDT"',
          },
        },
        required: ["symbol"],
      },
    },
    {
      name: "get_open_interest",
      description:
        "Get the current open interest for a crypto futures trading pair, " +
        "including 1-hour, 4-hour, and 24-hour change percentages. " +
        "Returns total outstanding contracts (base asset + notional USD) and how OI has shifted over time. " +
        "Rising OI with rising price = new longs entering (trend confirmation). " +
        "Rising OI with falling price = new shorts entering (bearish pressure). " +
        "Falling OI = positions closing (trend weakening). " +
        'Symbol format: "BTCUSDT" or "BTC/USDT". Exchange: Binance Futures.',
      inputSchema: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description: 'Futures trading pair, e.g. "BTCUSDT", "BTC/USDT", "ETHUSDT"',
          },
        },
        required: ["symbol"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "get_funding_rate") {
    const symbol = normalizeSymbol(args.symbol);
    try {
      const data = await binanceFutures("/fapi/v1/premiumIndex", { symbol });
      const rate = parseFloat(data.lastFundingRate);
      const markPrice = parseFloat(data.markPrice);
      const indexPrice = parseFloat(data.indexPrice);
      const nextFundingTime = new Date(data.nextFundingTime).toISOString();

      const summary = [
        `${symbol} | Binance Futures`,
        `Funding Rate: ${(rate * 100).toFixed(4)}% (${rate >= 0 ? "longs pay shorts" : "shorts pay longs"})`,
        `Mark Price: ${markPrice}`,
        `Index Price: ${indexPrice}`,
        `Next Funding: ${nextFundingTime}`,
      ].join("\n");

      return {
        content: [{
          type: "text",
          text: `${summary}\n\n${JSON.stringify({
            symbol,
            fundingRate: rate,
            fundingRatePercent: parseFloat((rate * 100).toFixed(4)),
            markPrice,
            indexPrice,
            nextFundingTime,
          })}`,
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }

  if (name === "get_open_interest") {
    const symbol = normalizeSymbol(args.symbol);
    try {
      // Current OI + mark price in parallel
      const [oiData, premium] = await Promise.all([
        binanceFutures("/fapi/v1/openInterest", { symbol }),
        binanceFutures("/fapi/v1/premiumIndex", { symbol }),
      ]);

      const currentOi = parseFloat(oiData.openInterest);
      const markPrice = parseFloat(premium.markPrice);
      const notionalUsd = currentOi * markPrice;
      const now = Date.now();

      // Fetch 24h of 5m OI history (288 entries) for change calculations
      const history = await binanceFutures("/futures/data/openInterestHist", {
        symbol,
        period: "5m",
        limit: "288",
      });

      const entries = history.map((d) => ({
        timestamp: d.timestamp,
        oi: parseFloat(d.sumOpenInterest),
        notional: parseFloat(d.sumOpenInterestValue),
      }));

      // Find closest entries to 1h, 4h, 24h ago
      const h1 = findClosest(entries, now - 1 * 60 * 60 * 1000);
      const h4 = findClosest(entries, now - 4 * 60 * 60 * 1000);
      const h24 = findClosest(entries, now - 24 * 60 * 60 * 1000);

      const change1h = h1 ? pctChange(currentOi, h1.oi) : null;
      const change4h = h4 ? pctChange(currentOi, h4.oi) : null;
      const change24h = h24 ? pctChange(currentOi, h24.oi) : null;

      const fmt = (v) => v !== null ? `${v >= 0 ? "+" : ""}${v}%` : "n/a";
      const base = symbol.replace("USDT", "");

      const summary = [
        `${symbol} | Binance Futures`,
        `Open Interest: ${fmtNum(currentOi, 3)} ${base}`,
        `Notional: $${fmtNum(notionalUsd, 0)}`,
        `Mark Price: ${markPrice}`,
        ``,
        `Change:  1h ${fmt(change1h)}  |  4h ${fmt(change4h)}  |  24h ${fmt(change24h)}`,
      ].join("\n");

      return {
        content: [{
          type: "text",
          text: `${summary}\n\n${JSON.stringify({
            symbol,
            openInterest: currentOi,
            notionalUsd: parseFloat(notionalUsd.toFixed(2)),
            markPrice,
            change1h,
            change4h,
            change24h,
            time: new Date(oiData.time).toISOString(),
          })}`,
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }

  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
