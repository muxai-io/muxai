# muxAI

The AI agent multiplexer. A self-hosted platform for creating, orchestrating, and managing teams of AI agents through a web interface.

## What is muxAI?

muxAI lets you build multi-agent teams that collaborate on tasks. Define agents with different roles, group them into hierarchical teams, and watch them work together in real-time. Agents communicate through MCP (Model Context Protocol) servers, capture structured results, and can even make autonomous payments via x402.

**Key capabilities:**

- **Multi-agent teams** with lead/reporter hierarchy and parallel orchestration
- **Built-in MCP servers** for news analysis, chart analysis, crypto data, OHLCV indicators, and more
- **Real-time streaming** of agent activity via SSE
- **Structured result capture** with customizable result cards
- **Contractor models** for cross-provider agent invocation (OpenRouter, GPT-4o, etc.)
- **x402 payments** with auto-generated Solana + Base wallets per agent
- **Heartbeat scheduling** for recurring agent runs via cron
- **Chat interface** for conversational interaction with agents
- **Team templates** for one-click deployment of pre-configured agent teams

## Stack

| Layer | Tech |
|---|---|
| Monorepo | Turborepo + pnpm workspaces |
| Database | PostgreSQL (embedded or Docker) + Prisma 7 |
| API | Express + TypeScript |
| Frontend | Next.js 16 + shadcn/ui + Tailwind |

## Project Structure

```
muxai-io/
├── apps/
│   ├── api/                Express backend (port 3001)
│   │   ├── prisma/         Schema + migrations
│   │   └── src/
│   │       ├── routes/     API endpoints
│   │       ├── services/   Business logic, adapters, spawn
│   │       └── lib/        Prisma client, utilities
│   └── web/                Next.js frontend (port 3000)
│       └── src/
│           ├── app/        Pages and routes
│           ├── components/ UI components
│           └── lib/        Templates, utilities, types
├── packages/
│   ├── mcp-orchestrator/   run_team + ask_reporter tools
│   ├── mcp-news-analyst/   RSS + CMC news aggregation
│   ├── mcp-chart-analyst/  Chart image analysis
│   ├── mcp-crypto-ohlcv/   OHLCV candles + technical indicators
│   ├── mcp-crypto-data/    Funding rates, OI, L/S ratio, taker volume
│   ├── mcp-wallet/         x402 wallet tools (address, fetch-and-pay)
│   ├── mcp-contractor/     Cross-provider model invocation
│   └── mcp-docs/           Mintlify documentation proxy
├── config/
│   └── mcp-registry.json   Built-in MCP server registry
├── install/                Install + update scripts
├── docker-compose.yml      Development database
└── docker-compose.test.yml Test database
```

## Quick Start

### Install and Run

For full installation and update instructions, see the [muxAI Quickstart Guide](https://muxaiio.mintlify.app/quickstart).

The guide covers prerequisites, install scripts, manual setup, configuration, and running the platform.

## Architecture

### Agent Lifecycle

1. **Create** an agent via the UI with a role, model, system prompt, and MCP configuration
2. **Run** on demand or via heartbeat schedule — the API spawns a Claude CLI process
3. **Stream** logs in real-time via SSE to the frontend
4. **Capture** structured results (trade decisions, analysis, etc.) from agent output
5. **Orchestrate** teams where a lead agent delegates to reporters via MCP tools

### MCP Isolation

Each agent runs with strict MCP configuration. Built-in servers are resolved from the registry, reporter agents are excluded from orchestrator tools (preventing recursive spawning), and custom MCP servers from the database are merged at runtime.

### Team Orchestration

Teams use a lead/reporter pattern:
- The **lead agent** has access to `run_team` (parallel broadcast) and `ask_reporter` (targeted follow-up) MCP tools
- **Reporter agents** run independently with their own MCP tools scoped to their role
- The lead synthesizes reporter outputs into a final result

## Testing

muxAI has two test suites: unit tests and integration tests.

```bash
# Unit tests (no database required)
pnpm test

# Integration tests (requires test database)
docker compose -f docker-compose.test.yml up -d
cd apps/api && pnpm test:integration
```

See [TESTING.md](TESTING.md) for full details on the test infrastructure, writing new tests, and CI setup.

## License

MIT
