import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db";
import { generateWallet, generateEvmWallet } from "../services/wallet";
import { syncAgentSchedule } from "../services/scheduler";

const AgentConfigSchema = z.object({
  name: z.string().min(1),
  role: z.string().default("general"),
  title: z.string().optional(),
  capabilities: z.string().optional(),
  adapterConfig: z.record(z.unknown()).default({}),
  runtimeConfig: z.record(z.unknown()).default({}),
  metadata: z.record(z.unknown()).optional(),
});

const DeployTeamSchema = z.object({
  lead: AgentConfigSchema,
  reporters: z.array(AgentConfigSchema).min(1),
});

export const teamRoutes = Router();

teamRoutes.post("/deploy", async (req, res) => {
  const parsed = DeployTeamSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { lead, reporters } = parsed.data;
  const total = 1 + reporters.length;

  try {
    // Generate all wallets in parallel
    const allWallets = await Promise.all(
      Array.from({ length: total }, () =>
        Promise.all([generateWallet(), generateEvmWallet()])
      )
    );

    // Create all agents in a single transaction
    const result = await prisma.$transaction(async (tx) => {
      const leadAgent = await tx.agent.create({
        data: {
          name: lead.name,
          role: lead.role,
          title: lead.title,
          capabilities: lead.capabilities,
          adapterType: "claude_local",
          adapterConfig: lead.adapterConfig,
          runtimeConfig: lead.runtimeConfig,
          metadata: lead.metadata,
          walletAddress: allWallets[0][0].address,
          walletKey: allWallets[0][0].keyBytes,
          walletAddressEvm: allWallets[0][1].address,
          walletKeyEvm: allWallets[0][1].keyHex,
        } as any,
      });

      const reporterAgents = await Promise.all(
        reporters.map((r, i) =>
          tx.agent.create({
            data: {
              name: r.name,
              role: r.role,
              title: r.title,
              capabilities: r.capabilities,
              adapterType: "claude_local",
              adapterConfig: r.adapterConfig,
              runtimeConfig: r.runtimeConfig,
              metadata: r.metadata,
              reportsToId: leadAgent.id,
              walletAddress: allWallets[i + 1][0].address,
              walletKey: allWallets[i + 1][0].keyBytes,
              walletAddressEvm: allWallets[i + 1][1].address,
              walletKeyEvm: allWallets[i + 1][1].keyHex,
            } as any,
          })
        )
      );

      return { lead: leadAgent, reporters: reporterAgents };
    });

    // Sync schedules outside the transaction
    await Promise.all([
      syncAgentSchedule(result.lead.id, result.lead.runtimeConfig),
      ...result.reporters.map((r) => syncAgentSchedule(r.id, r.runtimeConfig)),
    ]);

    // Return lead with reporters
    const full = await prisma.agent.findUniqueOrThrow({
      where: { id: result.lead.id },
      include: {
        reports: {
          select: { id: true, name: true, role: true, status: true, adapterConfig: true },
        },
      },
    });

    res.status(201).json(full);
  } catch (err) {
    console.error("[teams/deploy] Error:", err);
    res.status(500).json({ error: "Failed to deploy team" });
  }
});
