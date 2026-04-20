import "./env";
import express from "express";
import cors from "cors";
import { startDatabase } from "./services/database";
import { prisma } from "./lib/db";
import { agentRoutes } from "./routes/agents";
import { controlTowerRoutes } from "./routes/control-tower";
import { runRoutes } from "./routes/runs";
import { mcpServerRoutes } from "./routes/mcp-servers";
import { sandboxRoutes } from "./routes/sandbox";
import { roleRoutes } from "./routes/roles";
import { contractorRoutes } from "./routes/contractors";
import { chatRoutes } from "./routes/chat";
import { settingsRoutes } from "./routes/settings";
import { teamRoutes } from "./routes/teams";
import { initScheduler } from "./services/scheduler";
import "./services/adapters"; // Register all adapter types (claude_local, etc.)
import { onGlobalLog } from "./services/run-events";
import { apiKeyAuth } from "./middleware/auth";

const DEFAULT_ROLES = [
  { name: "general", description: "General-purpose agent" },
  { name: "analyst", description: "Data or market analyst" },
  { name: "news-analyst", description: "Monitors and summarises news" },
  { name: "technical-analyst", description: "Chart and technical analysis" },
  { name: "researcher", description: "Deep research and information gathering" },
  { name: "engineer", description: "Software engineering tasks" },
  { name: "ceo", description: "High-level strategy and orchestration" },
  { name: "cto", description: "Technical strategy and architecture" },
];

const DEFAULT_SETTINGS: Record<string, string> = {
  solana_network: "devnet",
  solana_rpc_url: "https://api.devnet.solana.com",
  base_network: "mainnet",
  base_rpc_url: "https://mainnet.base.org",
};

async function seedDefaultSettings() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }
}

async function seedDefaultRoles() {
  const count = await prisma.agentRole.count();
  if (count > 0) return;
  await prisma.agentRole.createMany({ data: DEFAULT_ROLES, skipDuplicates: true });
  console.log("Seeded default agent roles");
}

const app = express();
const PORT = process.env.API_PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(apiKeyAuth);

app.use("/api/agents", agentRoutes);
app.use("/api/control-tower", controlTowerRoutes);
app.use("/api/runs", runRoutes);
app.use("/api/mcp-servers", mcpServerRoutes);
app.use("/api/sandbox", sandboxRoutes);
app.use("/api/roles", roleRoutes);
app.use("/api/contractors", contractorRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/teams", teamRoutes);

// GET /api/logs/stream — global SSE stream for all agent activity
app.get("/api/logs/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const unsubscribe = onGlobalLog((event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      unsubscribe();
    }
  });

  req.on("close", () => unsubscribe());
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

async function cleanupStaleRuns() {
  const result = await prisma.heartbeatRun.updateMany({
    where: { status: { in: ["running", "queued"] } },
    data: { status: "failed", finishedAt: new Date(), errorMsg: "Marked failed on startup — process died without cleanup" },
  });
  if (result.count > 0) {
    console.log(`[muxai] Cleaned up ${result.count} stale run(s) from previous session`);
  }
  // Reset any agents stuck in running state
  await prisma.agent.updateMany({
    where: { status: "running" },
    data: { status: "error" },
  });
}

async function main() {
  await startDatabase();
  app.listen(PORT, async () => {
    console.log(`muxai API running on http://localhost:${PORT}`);
    await cleanupStaleRuns();
    await seedDefaultSettings();
    await seedDefaultRoles();
    await initScheduler();
  });
}

main().catch((err) => {
  console.error("[muxai] Fatal startup error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
