# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Control Tower singleton admin agent (`role = "control_tower"`): dedicated `/control-tower` page, sidebar entry, one-click setup, and a red-ringed chat integration with `?agent=<id>` preselect from the Open chat button
- `POST/GET /api/control-tower` routes to manage the singleton; reserved role enforced on `POST /api/agents` and filtered out of `/api/agents` list + memory summary
- `packages/mcp-control-tower` MCP server with admin tools (`list_agents`, `invoke_agent`, `get_run_status`); wired into `config/mcp-registry.json` and `.claude/settings.json`
- Claude-local adapter now excludes `mcp-control-tower` from every non-admin spawn and excludes `mcp-wallet` from the Control Tower
- Edit page Configure link from `/control-tower`, with Control-Tower-specific guardrails: Name field locked, Role / Title / Reports To hidden, MCP Servers preset hidden (always built-in), and `mcp-control-tower` tools locked against being disabled
- API guardrail on `PATCH /api/agents/:id` strips `name`, `role`, `title`, `reportsToId`, and any `mcp__control-tower__*` disallow entries for Control Tower agents
- Agent edit / new pages hide admin-only MCP servers from the tool grid (`control-tower` on non-admin pages; `wallet` and `orchestrator` on the Control Tower edit page) to match the server-side exclusion in `claude-local.ts`
- Docs: `core-concepts/control-tower` covering the singleton model, MCP access matrix, and admin tools

### Fixed

- `/chat` page now reacts to `?agent=<id>` URL changes during client-side navigation via `useSearchParams` (previous initial-state approach required a hard refresh when arriving from the Open chat button)

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

### Fixed

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
