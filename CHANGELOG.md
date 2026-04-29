# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.5] - 2026-04-29

### Added

- Auto-resolve trade outcomes — pure resolver at `apps/api/src/services/trade-resolver.ts` (LONG/SHORT win/loss, no-fill expiry, gap-through-SL, same-bar collision, mark-to-market on expiry); 16 unit tests
- Background tick at `apps/api/src/services/trade-resolver-tick.ts` — every 60s, queries open trade-decision runs with `autoResolve.enabled !== false`, groups by `(exchange, symbol, timeframe)`, fetches Binance klines, resolves, persists
- Three new nullable columns on `HeartbeatRun`: `resolutionStatus`, `resolutionCheckedAt`, `resolutionMeta`. `outcomeFields.source = "auto" | "manual"` distinguishes resolution path
- Per-agent auto-resolve config on `adapterConfig.resultCard.autoResolve`: `{ enabled, exchange, expireBars, fillTolerancePct }`. Exchange field is a `<Select>` (Binance only). Outcome card on the run detail page shows an amber note when auto-resolve is on
- Manual entry/exit overrides — `POST /api/runs/:id/manual-entry` and `POST /api/runs/:id/manual-exit` routes; resolver tick reconciles `manualEntry`/`manualExit` on `resolutionMeta`. `apps/web/src/components/manual-trade-panel.tsx` embedded on both run detail page and Results page chart pane
- Scheduler registry at `apps/api/src/services/scheduler-registry.ts` — in-memory map exposing heartbeat (per-agent), Telegram poller (per-agent), and the global trade-resolver. `GET /api/schedulers` snapshot endpoint
- Schedulers panel on `/control-tower` (`apps/web/src/app/control-tower/schedulers-panel.tsx`) — polls every 5s with status LED, kind badge, schedule pill, last-tick relative time, and per-kind meta
- Results page → trading terminal (`apps/web/src/app/results/terminal.tsx`) — two-pane blotter + Result Card layout with aggregate strip (Active / Closed / Cumulative R / Hit rate / Profit factor) toggled by 24h / 7d / all, status + side filters, and collapsible Chart and Decision JSON sections
- `apps/web/src/components/monitoring-badge.tsx` — reusable resolution-state pill (pending / active / Win+R / Loss+R / expired) used on Results blotter and run lists
- TradingView Lightweight Charts integration (`lightweight-charts@5.2.0`, MIT, self-hosted) at `apps/web/src/components/trade-chart.tsx` — candlesticks + dashed entry/TP/SL price-lines + decision and resolution markers
- Position-box primitive on the chart — green TP zone + red SL zone drawn under candles between decision time and exit/now (z-order `bottom`); snaps decision/exit times to nearest bar across timeframes
- EMA 20 / 50 / 200 client-computed overlays and volume histogram in a separate sub-pane (~80px); default chart height bumped to 480; default zoom −200 / +300 bars around decision
- New `GET /api/candles` proxy to Binance klines (server-side, up to 1000 candles); `since = decisionAt − 800·intervalMs` so 1000-candle requests return ~1000
- Run detail page polish — one-line meta strip (Source · Exit · Duration · Started · Finished); merged Result + Logs into one card with two `<details>` collapsibles

### Changed

- Result card pruning — removed `task-decision`, `alert`, `metric-report`, `sentiment`, `research-summary` from `CARD_TYPES`; only `trade-decision` remains alongside `none` and `raw`. Agents using removed types fall through to no card render with raw JSON preserved

## [0.1.4] - 2026-04-21

### Added

- Control Tower singleton admin agent (`role = "control_tower"`): dedicated `/control-tower` page, sidebar entry, one-click setup, and a red-ringed chat integration with `?agent=<id>` preselect from the Open chat button
- `POST/GET /api/control-tower` routes to manage the singleton; reserved role enforced on `POST /api/agents` and filtered out of `/api/agents` list + memory summary
- `packages/mcp-control-tower` MCP server with admin tools (`list_agents`, `invoke_agent`, `get_run_status`, `get_agent_decisions`, `stop_agent`, `pause_agent`, `resume_agent`, `reset_agent_memory`); wired into `config/mcp-registry.json` and `.claude/settings.json`
- Claude-local adapter now excludes `mcp-control-tower` from every non-admin spawn and excludes `mcp-wallet` from the Control Tower
- Edit page Configure link from `/control-tower`, with Control-Tower-specific guardrails: Name field locked, Role / Title / Reports To hidden, MCP Servers preset hidden (always built-in), and `mcp-control-tower` tools locked against being disabled
- API guardrail on `PATCH /api/agents/:id` strips `name`, `role`, `title`, `reportsToId`, and any `mcp__control-tower__*` disallow entries for Control Tower agents
- Agent edit / new pages hide admin-only MCP servers from the tool grid (`control-tower` on non-admin pages; `wallet` and `orchestrator` on the Control Tower edit page) to match the server-side exclusion in `claude-local.ts`
- `/control-tower` page redesign — ops-deck aesthetic with callsign header (`TWR-01`), status LED, red-tinted grid overlay, monospace readouts (Status / Model / Messages / Uptime), and an emerald-lit "Comms channels" grid (In-app chat online; Telegram / Discord / WhatsApp on standby)
- Telegram gateway (polling, no webhook) at `apps/api/src/services/gateways/telegram.ts` — single-owner pairing via `/start`, owner commands `/whoami` and `/reset`, typing indicator during relay, and config colocated on the agent at `adapterConfig.gateways.telegram`
- `/control-tower` Telegram setup wizard: paste bot token → validate via `getMe` → poll for `/start` every 2s → connected; Cancel mid-pairing stops the poller to avoid leaks
- `apps/api/src/services/chat-runner.ts` — reusable chat-turn helper shared by the web `/chat` route and the Telegram gateway; default `maxMs` raised from 180s to 900s to cover `invoke_agent` chains
- Control Tower SKILL.md rule: acknowledge before slow work (`invoke_agent`, `get_agent_decisions`) so remote users see a preamble instead of silence
- Live **Sector Scan** radar on `/control-tower` — polls `/api/agents` every 5s and renders one blip per agent, color-coded by status (running pulses amber near center, idle emerald on outer rings, error red, paused/terminated grey); blip position is deterministic per agent id
- "Details" button on `/control-tower` linking to `/agents/<id>`, next to Configure and Open chat
- Control Tower details page hides panels that don't apply to a chat-only agent: Active Memory panel, Memory info panel, Result Card panel, Notifications panel
- Control Tower edit page hides "Review Previous Decisions" toggle and the entire Schedule step; Active Memory switch is locked on with an explanatory caption
- API guardrails on `PATCH /api/agents/:id` enforce Control Tower invariants server-side: `memoryEnabled: true`, `reviewDecisions: false`, and any incoming `runtimeConfig.heartbeat.enabled` is forced to `false`
- Docs: `core-concepts/control-tower` covering the singleton model, MCP access matrix, and admin tools

## [0.1.3] - 2026-04-19

### Added

- Active Memory per-agent toggle (off by default) — opt-in shared Claude session between chat and scheduled runs via `--resume`, with amber warning on enable
- Memory status endpoints: `GET /api/agents/:id/memory`, batched `GET /api/agents/memory-summary`, and `POST /api/agents/:id/memory/reset`
- `/agents` list page now shows a summary strip (totals, scheduled, memory-on, drifting count), a memory pill on each card with drift warning past 20 runs, inline dialog-based Reset button, and drift-first sort
- Per-agent Active Memory panel on agent detail page with status, runs-since-reset, session age, and in-panel reset
- Collapsible "What does this agent remember?" info panel on agent detail, with side-by-side Off/On comparison, session-flow diagram, quick-reference table, and the prompt-precedence caveat
- New docs page `core-concepts/memory-and-decisions` covering Active Memory, `reviewDecisions`, session flow, resets, and the underlying schema
- `ChatSession.lastResetAt` column as a stable counter anchor, bumped on explicit reset and when memory is toggled off→on so re-enabling starts from a clean slate
- Trade Decision result card gains optional `thesis_evolution` and `previous_decisions` slots; Team Lead SKILL.md updated with the JSON format and a no-fabrication guardrail
- Dashboard replaces the four stat cards with a single compact status bar.
- `.claude/settings.json` now registers all eight MCP servers (adds `crypto-data`, `crypto-ohlcv`, `docs`)

## [0.1.2] - 2026-04-18

### Added

- Decision recall for trading agents: `reviewDecisions` template flag plus `mcp__orchestrator__get_my_decisions` tool surfaces an agent's last decisions and user-marked outcomes on its next run, with a win/loss tally and reflection nudge
- Outcome tracking on runs: `outcome` label (user-definable — Win / Loss / NA / custom) plus free-form `outcomeFields` key/value pairs (pnl, note, fees, etc.), editable from the run detail page
- Compact Recent Runs layout on agent detail and `/agents/[id]/runs` pages, with one-line decision summary plucked from the agent's `resultCard` slots and an outcome badge
- Bump default model to `claude-opus-4-7`; Technical Analyst template updated from `claude-opus-4-6` to `claude-opus-4-7`

### Fixed

- Guard wallet-key JSON parsing in `services/wallet.ts` so corrupted records surface a clear error instead of crashing callers
- Deep-merge `adapterConfig` on `PATCH /api/agents/:id` so nested fields (`resultCard.fields`, etc.) are no longer wiped by partial updates
- Periodically sweep stale entries from the SSE replay buffer (`services/run-events.ts`) so orphan runs don't leak memory
- Reject `POST /api/agents/:id/invoke` with 409 when the agent is already running, preventing duplicate concurrent spawns
- Close child stdin after the handshake in the MCP server test route so processes exit cleanly
- Return a proper MCP `isError` response for unknown tool names in `mcp-crypto-data`

## [0.1.1] - 2026-04-09

Initial release.
