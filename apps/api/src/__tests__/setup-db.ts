/**
 * Test database setup — uses a separate Postgres instance for integration tests.
 *
 * Prerequisites:
 *   docker compose -f docker-compose.test.yml up -d
 *
 * The test DB runs on port 5434 with credentials muxai_test_user/muxai_test_password.
 * Schema is pushed once before all tests, tables are truncated between tests.
 */
import { execSync } from "child_process";
import path from "path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { beforeAll, afterAll, afterEach } from "vitest";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://muxai_test_user:muxai_test_password@localhost:5434/muxai_test";

let client: PrismaClient;

export function setupTestDb() {
  beforeAll(async () => {
    // Push schema to test database
    const apiRoot = path.resolve(__dirname, "../../");
    execSync("npx prisma db push --accept-data-loss", {
      cwd: apiRoot,
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    });

    // Create a dedicated prisma client for tests
    const adapter = new PrismaPg({ connectionString: TEST_DATABASE_URL });
    client = new PrismaClient({ adapter });
  });

  afterEach(async () => {
    // Truncate all tables between tests (order matters for FK constraints)
    await client.$executeRawUnsafe(`
      TRUNCATE TABLE chat_messages, chat_sessions, heartbeat_runs,
        wakeup_requests, mcp_servers, contractors, agents, agent_roles, settings
      CASCADE
    `);
  });

  afterAll(async () => {
    await client.$disconnect();
  });
}

export function getTestPrisma() {
  return client;
}
