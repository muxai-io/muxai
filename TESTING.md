# Testing

muxAI uses [Vitest](https://vitest.dev/) for both unit and integration tests. The test suites are separated so unit tests run fast without any infrastructure, while integration tests verify real database operations.

## Unit Tests

Unit tests cover pure logic: stream parsing, process management, MCP config building, adapter types, and Claude CLI argument construction. No database or external services required.

```bash
# From the project root
pnpm test

# From the API package
cd apps/api && pnpm test

# Watch mode (re-runs on file change)
cd apps/api && pnpm test:watch
```

**Location:** `apps/api/src/services/__tests__/` and `apps/api/src/services/adapters/__tests__/`

**Config:** `apps/api/vitest.config.ts`

### What's covered

| Test file | What it tests |
|---|---|
| `stream-parser.test.ts` | `parseStreamJson`, `extractAssistantText`, `extractLastJson` — parsing Claude CLI stream-json output, JSON extraction from logs |
| `process-manager.test.ts` | Process tracking, cleanup, stop signals, active count |
| `claude-spawn.test.ts` | `buildMcpConfig` — MCP registry reading, server filtering, config generation |
| `claude-local.test.ts` | `buildSpawnConfig` — CLI argument construction from adapter config (model, turns, effort, MCP, chrome, prompts) |
| `types.test.ts` | Adapter registry, type validation |
| `mcp-servers.test.ts` | Live MCP server connectivity, tool listing for built-in servers |

## Integration Tests

Integration tests run against a real PostgreSQL database. They verify data models, relationships, cascade deletes, query patterns, and the exact data shapes the API returns.

### Setup

**1. Start the test database:**

```bash
docker compose -f docker-compose.test.yml up -d
```

This starts a PostgreSQL 18 instance on **port 5434** with:
- Database: `muxai_test`
- User: `muxai_test_user`
- Password: `muxai_test_password`

This is completely isolated from the development database (port 5432).

**2. Run the tests:**

```bash
# From the project root
cd apps/api && pnpm test:integration

# Or directly with vitest
cd apps/api && npx vitest run --config vitest.integration.config.ts
```

**3. Stop the test database when done:**

```bash
docker compose -f docker-compose.test.yml down
```

To also remove the data volume:

```bash
docker compose -f docker-compose.test.yml down -v
```

### How it works

The test setup (`src/__tests__/setup-db.ts`) handles everything automatically:

1. **Before all tests** in each file: pushes the Prisma schema to the test database and creates a dedicated PrismaClient
2. **After each test**: truncates all tables (with CASCADE) so every test starts with a clean database
3. **After all tests**: disconnects the client
4. **Files run sequentially** (`fileParallelism: false`) to prevent cross-file data interference

**Location:** `apps/api/src/__tests__/`

**Config:** `apps/api/vitest.integration.config.ts`

### What's covered

| Test file | What it tests |
|---|---|
| `agents.integration.test.ts` | Agent CRUD, default values, status updates, cascade deletes (agent + runs), hierarchy (reportsTo), ordering |
| `runs.integration.test.ts` | Run creation, resultJson storage/retrieval, adapterConfig inclusion in queries, status filtering, session ID persistence |
| `settings-roles.integration.test.ts` | Settings CRUD, upsert behavior, multi-key queries, role uniqueness, `skipDuplicates` seeding |

### Custom test database URL

By default, tests connect to `postgresql://muxai_test_user:muxai_test_password@localhost:5434/muxai_test`. Override with:

```bash
TEST_DATABASE_URL="postgresql://user:pass@host:port/db" pnpm test:integration
```

## Writing New Tests

### Unit tests

Add files to `apps/api/src/services/__tests__/` matching the pattern `*.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("my feature", () => {
  it("does the thing", () => {
    expect(1 + 1).toBe(2);
  });
});
```

### Integration tests

Add files to `apps/api/src/__tests__/` matching the pattern `*.integration.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { setupTestDb, getTestPrisma } from "./setup-db";

setupTestDb();

describe("my data flow", () => {
  it("creates and queries data", async () => {
    const prisma = getTestPrisma();

    const agent = await prisma.agent.create({
      data: { name: "Test Agent", role: "analyst" },
    });

    expect(agent.id).toBeDefined();

    const fetched = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(fetched!.name).toBe("Test Agent");
  });
});
```

Each test starts with a clean database. No need for manual cleanup.

## Running Everything

```bash
# Start test DB, run all tests, stop test DB
docker compose -f docker-compose.test.yml up -d
pnpm test && cd apps/api && pnpm test:integration
docker compose -f docker-compose.test.yml down
```
