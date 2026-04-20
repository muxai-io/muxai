import { Router } from "express";
import path from "path";
import fs from "fs";
import { prisma } from "../lib/db";
import { generateWallet, generateEvmWallet } from "../services/wallet";
import { syncAgentSchedule } from "../services/scheduler";
import { MUXAI_ROOT } from "../services/claude-spawn";
import { DEFAULT_MODEL } from "../services/models";

export const controlTowerRoutes = Router();

const CONTROL_TOWER_ROLE = "control_tower";

function loadSkill(): string {
  const skillPath = path.join(MUXAI_ROOT, "apps/web/src/lib/agent-templates/control-tower/SKILL.md");
  try {
    return fs.readFileSync(skillPath, "utf-8");
  } catch {
    return "";
  }
}

// GET /api/control-tower — returns the singleton agent or null
controlTowerRoutes.get("/", async (_req, res) => {
  const agent = await prisma.agent.findFirst({
    where: { role: CONTROL_TOWER_ROLE },
  });
  if (!agent) {
    res.json({ agent: null, messageCount: 0 });
    return;
  }
  const session = await prisma.chatSession.findFirst({ where: { agentId: agent.id } });
  const messageCount = session
    ? await prisma.chatMessage.count({ where: { sessionId: session.id } })
    : 0;
  res.json({ agent, messageCount });
});

// POST /api/control-tower — creates the singleton if it doesn't already exist
controlTowerRoutes.post("/", async (_req, res) => {
  const existing = await prisma.agent.findFirst({ where: { role: CONTROL_TOWER_ROLE } });
  if (existing) {
    res.status(409).json({ error: "Control Tower already exists", agent: existing });
    return;
  }

  const promptTemplate = loadSkill();
  const [wallet, evmWallet] = await Promise.all([generateWallet(), generateEvmWallet()]);

  const agent = await prisma.agent.create({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: {
      name: "Control Tower",
      role: CONTROL_TOWER_ROLE,
      title: "Admin Agent",
      capabilities: "Invoke agents, query runs and decisions, administer the muxAI deployment.",
      adapterType: "claude_local",
      adapterConfig: {
        model: DEFAULT_MODEL,
        cwd: MUXAI_ROOT,
        disallowedTools: "Read,Write,Edit,Bash,Grep,Glob,Agent",
        maxTurnsPerRun: 30,
        promptTemplate,
        memoryEnabled: true,
        persistLogs: true,
      },
      runtimeConfig: {},
      walletAddress: wallet.address,
      walletKey: wallet.keyBytes,
      walletAddressEvm: evmWallet.address,
      walletKeyEvm: evmWallet.keyHex,
    } as any,
  });

  syncAgentSchedule(agent.id, agent.runtimeConfig);
  res.status(201).json({ agent });
});
