export const SKILL_PLACEHOLDER = `---
name:
description: >
  Routing description — tells the lead agent WHEN to invoke this skill.
  Decision logic, not marketing copy.
---

# Agent Instructions

Your instructions here...`;

export interface AgentTemplate {
  id: string;
  label: string;
  description: string;
  defaultPrompt?: string;
  form: {
    name: string;
    role: string;
    title: string;
    capabilities: string;
    model: string;
    cwd: string;
    disallowedTools: string;
    maxTurnsPerRun: string;
    customCron: string;
  };
  mcpPreset: string;
  schedulePreset: string;
  useChrome?: boolean;
  persistLogs?: boolean;
  resultCard?: { type: string; mapping: Record<string, string> };
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "team-lead",
    label: "Team Lead",
    description: "Lead orchestrator — gathers findings from all team members and outputs a final decision.",
    defaultPrompt:
      "Instruct your team to deliver a detailed analysis of BTC/USDT on the 4-hour timeframe. Each team member must strictly use their assigned tools and operate within their specific area of expertise and do not perform tasks outside their role or use tools which are not assigned.",
    mcpPreset: "builtin",
    schedulePreset: "disabled",
    resultCard: { type: "trade-decision", mapping: {} },
    persistLogs: true,
    form: {
      name: "Team Lead",
      role: "ceo",
      title: "Team Lead",
      capabilities:
        "You are an expert Team Lead skilled at gathering team feedback, facilitating constructive discussions, and making concise, well-reasoned decisions. Always stay professional, balanced, and solution-oriented. Be concise and decisive, keeping in mind your teams feedback.",
      model: "claude-sonnet-4-6",
      cwd: "",
      disallowedTools: "Read,Write,Edit,Bash,Grep,Glob,Agent,mcp__news-analyst__get_crypto_news,mcp__chart-analyst__analyze_chart,mcp__crypto-ohlcv__get_candles,mcp__crypto-ohlcv__get_indicators,mcp__crypto-ohlcv__search_symbols,mcp__crypto-data__get_funding_rate,mcp__crypto-data__get_open_interest,mcp__crypto-data__get_long_short_ratio,mcp__crypto-data__get_top_trader_positions,mcp__crypto-data__get_taker_buy_sell_volume",
      maxTurnsPerRun: "30",
      customCron: "",
    },
  },
  {
    id: "news-analyst",
    label: "News Analyst",
    description: "Fetches crypto news from RSS feeds and CMC, assesses sentiment and impact.",
    mcpPreset: "builtin",
    schedulePreset: "disabled",
    persistLogs: true,
    form: {
      name: "News Analyst",
      role: "news-analyst",
      title: "Crypto News Analyst",
      capabilities: "Cryptocurrency news gathering, sentiment analysis, impact assessment",
      model: "claude-sonnet-4-6",
      cwd: "",
      disallowedTools: "Read,Write,Edit,Bash,Grep,Glob,Agent,mcp__chart-analyst__analyze_chart,mcp__crypto-ohlcv__get_candles,mcp__crypto-ohlcv__get_indicators,mcp__crypto-ohlcv__search_symbols,mcp__crypto-data__get_funding_rate,mcp__crypto-data__get_open_interest,mcp__crypto-data__get_long_short_ratio,mcp__crypto-data__get_top_trader_positions,mcp__crypto-data__get_taker_buy_sell_volume,mcp__wallet__wallet_address,mcp__wallet__wallet_fetch,mcp__contractor__ask_contractor,mcp__contractor__list_contractors,mcp__orchestrator__run_team,mcp__orchestrator__ask_reporter,mcp__orchestrator__get_my_decisions",
      maxTurnsPerRun: "10",
      customCron: "",
    },
  },
  {
    id: "technical-analyst",
    label: "Technical Analyst",
    description: "Analyzes charts and CMC technical data to identify directional bias.",
    defaultPrompt: "When performing technical analysis, always load and review at least the last 390 candles of OHLCV data.",
    mcpPreset: "builtin",
    schedulePreset: "disabled",
    persistLogs: true,
    form: {
      name: "Technical Analyst",
      role: "technical-analyst",
      title: "Crypto Technical Analyst",
      capabilities: "Chart pattern recognition, technical indicator analysis, support/resistance identification",
      model: "claude-opus-4-6",
      cwd: "",
      disallowedTools: "Read,Write,Edit,Bash,Grep,Glob,Agent,mcp__news-analyst__get_crypto_news,mcp__crypto-data__get_funding_rate,mcp__crypto-data__get_open_interest,mcp__crypto-data__get_long_short_ratio,mcp__crypto-data__get_top_trader_positions,mcp__crypto-data__get_taker_buy_sell_volume,mcp__wallet__wallet_address,mcp__wallet__wallet_fetch,mcp__contractor__ask_contractor,mcp__contractor__list_contractors,mcp__orchestrator__run_team,mcp__orchestrator__ask_reporter,mcp__orchestrator__get_my_decisions",
      maxTurnsPerRun: "10",
      customCron: "",
    },
  },
  {
    id: "data-analyst",
    label: "Data Analyst",
    description: "Analyzes open interest, funding rates, and fear & greed index.",
    mcpPreset: "builtin",
    schedulePreset: "disabled",
    persistLogs: true,
    useChrome: false,
    form: {
      name: "Data Analyst",
      role: "analyst",
      title: "Crypto Data Analyst",
      capabilities: "Open interest analysis, funding rate interpretation, fear & greed assessment",
      model: "claude-sonnet-4-6",
      cwd: "",
      disallowedTools: "Read,Write,Edit,Bash,Grep,Glob,Agent,mcp__news-analyst__get_crypto_news,mcp__chart-analyst__analyze_chart,mcp__crypto-ohlcv__get_candles,mcp__crypto-ohlcv__get_indicators,mcp__crypto-ohlcv__search_symbols,mcp__wallet__wallet_address,mcp__wallet__wallet_fetch,mcp__contractor__ask_contractor,mcp__contractor__list_contractors,mcp__orchestrator__run_team,mcp__orchestrator__ask_reporter,mcp__orchestrator__get_my_decisions",
      maxTurnsPerRun: "10",
      customCron: "",
    },
  },
];
