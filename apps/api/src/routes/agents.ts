import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db";
import { invokeAgent, stopRun, buildInvokeInfo } from "../services/heartbeat";
import { syncAgentSchedule } from "../services/scheduler";
import { generateWallet, exportWalletKey, generateEvmWallet, exportEvmWalletKey } from "../services/wallet";
import { isInternalRequest } from "../services/internal-secret";

const USDC_MINTS: Record<string, string> = {
  "mainnet-beta": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "devnet": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};

async function getSolanaConfig() {
  const rows = await prisma.setting.findMany({
    where: { key: { in: ["solana_network", "solana_rpc_url"] } },
  });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const network = map.solana_network || "devnet";
  const rpcUrl = map.solana_rpc_url || "https://api.devnet.solana.com";
  const usdcMint = USDC_MINTS[network] ?? USDC_MINTS["devnet"];
  return { network, rpcUrl, usdcMint };
}

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ERC20_BALANCE_OF = "0x70a08231"; // balanceOf(address) selector

async function getBaseConfig() {
  const rows = await prisma.setting.findMany({
    where: { key: { in: ["base_network", "base_rpc_url"] } },
  });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    network: map.base_network || "mainnet",
    rpcUrl: map.base_rpc_url || "https://mainnet.base.org",
  };
}

async function getBaseBalances(address: string, rpcUrl: string) {
  // Pad address to 32 bytes for ABI encoding
  const paddedAddress = address.slice(2).toLowerCase().padStart(64, "0");

  const [ethRes, usdcRes] = await Promise.all([
    fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }),
    }),
    fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 2, method: "eth_call",
        params: [{ to: BASE_USDC, data: `${ERC20_BALANCE_OF}${paddedAddress}` }, "latest"],
      }),
    }),
  ]);

  const ethData = await ethRes.json() as { result?: string; error?: { message: string } };
  const usdcData = await usdcRes.json() as { result?: string; error?: { message: string } };

  if (ethData.error) throw new Error(`Base RPC error: ${ethData.error.message}`);

  const ethBalance = ethData.result && ethData.result !== "0x" ? Number(BigInt(ethData.result)) / 1e18 : 0;
  const usdcBalance = usdcData.result && usdcData.result !== "0x" ? Number(BigInt(usdcData.result)) / 1e6 : 0;

  return { ethBalance, usdcBalance };
}

export const agentRoutes = Router();

const CreateAgentSchema = z.object({
  name: z.string().min(1),
  role: z.string().default("general"),
  title: z.string().optional(),
  capabilities: z.string().optional(),
  adapterType: z.string().default("claude_local"),
  adapterConfig: z.record(z.unknown()).default({}),
  runtimeConfig: z.record(z.unknown()).default({}),
  reportsToId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const UpdateAgentSchema = CreateAgentSchema.partial().extend({
  status: z.enum(["idle", "running", "paused", "error", "terminated"]).optional(),
});

// GET /api/agents
agentRoutes.get("/", async (_req, res) => {
  const agents = await prisma.agent.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      reportsTo: { select: { id: true, name: true, role: true } },
      reports: { select: { id: true, name: true, role: true, status: true, adapterConfig: true } },
      _count: { select: { runs: true } },
    },
  });
  res.json(agents);
});

// POST /api/agents
agentRoutes.post("/", async (req, res) => {
  const parsed = CreateAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const [wallet, evmWallet] = await Promise.all([generateWallet(), generateEvmWallet()]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agent = await prisma.agent.create({
    data: {
      ...parsed.data,
      walletAddress: wallet.address, walletKey: wallet.keyBytes,
      walletAddressEvm: evmWallet.address, walletKeyEvm: evmWallet.keyHex,
    } as any,
  });
  syncAgentSchedule(agent.id, agent.runtimeConfig);
  res.status(201).json(agent);
});

// GET /api/agents/:id
agentRoutes.get("/:id", async (req, res) => {
  const agent = await prisma.agent.findUnique({
    where: { id: req.params.id },
    include: {
      reportsTo: { select: { id: true, name: true, role: true } },
      reports: { select: { id: true, name: true, role: true, status: true, adapterConfig: true } },
      _count: { select: { runs: true } },
    },
  });
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json(agent);
});

// PATCH /api/agents/:id
agentRoutes.patch("/:id", async (req, res) => {
  const parsed = UpdateAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  // Merge adapterConfig with existing values so the edit form doesn't wipe
  // fields it doesn't manage (resultCard, notifications, etc.)
  const data = { ...parsed.data };
  if (data.adapterConfig) {
    const existing = await prisma.agent.findUnique({ where: { id: req.params.id }, select: { adapterConfig: true } });
    const existingConfig = (existing?.adapterConfig ?? {}) as Record<string, unknown>;
    data.adapterConfig = { ...existingConfig, ...data.adapterConfig };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agent = await prisma.agent.update({ where: { id: req.params.id }, data: data as any });
  syncAgentSchedule(agent.id, agent.runtimeConfig, agent.status);
  res.json(agent);
});

// DELETE /api/agents/:id — soft delete (terminate)
agentRoutes.delete("/:id", async (req, res) => {
  const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  const updated = await prisma.agent.update({
    where: { id: req.params.id },
    data: { status: "terminated" },
  });
  syncAgentSchedule(updated.id, updated.runtimeConfig, "terminated");
  res.status(204).send();
});

// DELETE /api/agents/:id/purge — hard delete (irreversible)
agentRoutes.delete("/:id/purge", async (req, res) => {
  const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  if (agent.status !== "terminated") {
    res.status(400).json({ error: "Agent must be terminated before purging" });
    return;
  }
  // Null out reportsToId on subordinates so FK doesn't block delete
  await prisma.agent.updateMany({
    where: { reportsToId: req.params.id },
    data: { reportsToId: null },
  });
  // Hard delete — cascades HeartbeatRun and WakeupRequest automatically
  await prisma.agent.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

// POST /api/agents/:id/invoke — manually trigger a heartbeat run
agentRoutes.post("/:id/invoke", async (req, res) => {
  const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  if (agent.status === "terminated") {
    res.status(400).json({ error: "Cannot invoke a terminated agent" });
    return;
  }

  const task = typeof req.body?.task === "string" ? req.body.task : undefined;
  const run = await invokeAgent(agent.id, task);
  res.status(202).json(run);
});

// POST /api/agents/:id/stop — kill the active run for this agent
agentRoutes.post("/:id/stop", async (req, res) => {
  const run = await prisma.heartbeatRun.findFirst({
    where: { agentId: req.params.id, status: { in: ["running", "queued"] } },
    orderBy: { startedAt: "desc" },
  });
  if (!run) {
    res.status(404).json({ error: "No active run found" });
    return;
  }
  const killed = stopRun(run.id);
  // Whether or not the process was alive, mark the DB record as cancelled
  await prisma.heartbeatRun.update({
    where: { id: run.id },
    data: { status: "cancelled", finishedAt: new Date(), errorMsg: killed ? null : "Force-cancelled — process was not found" },
  });
  await prisma.agent.update({ where: { id: req.params.id }, data: { status: "idle" } });
  res.json({ stopped: true, runId: run.id, wasAlive: killed });
});

// GET /api/agents/:id/wallet/key — internal only, returns decrypted keypair bytes for MCP servers
agentRoutes.get("/:id/wallet/key", async (req, res) => {
  if (!isInternalRequest(req)) {
    res.status(401).json({ error: "Internal access only" });
    return;
  }
  const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  if (!agent.walletKey && !agent.walletKeyEvm) { res.status(404).json({ error: "No wallet" }); return; }
  try {
    const solana = agent.walletKey ? await exportWalletKey(agent.walletKey) : null;
    const evmKey = agent.walletKeyEvm ? await exportEvmWalletKey(agent.walletKeyEvm) : null;
    res.json({
      address: agent.walletAddress,
      keyBytes: solana?.secretKeyJson ?? null,
      secretKeyBase58: solana?.secretKeyBase58 ?? null,
      addressEvm: agent.walletAddressEvm,
      keyHexEvm: evmKey,
    });
  } catch {
    res.status(500).json({ error: "Failed to decrypt wallet key" });
  }
});

// GET /api/agents/:id/wallet — return Solana + Base addresses and balances
agentRoutes.get("/:id/wallet", async (req, res) => {
  const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  const [solanaConfig, baseConfig] = await Promise.all([getSolanaConfig(), getBaseConfig()]);
  const { network, rpcUrl, usdcMint } = solanaConfig;
  const { network: baseNetwork, rpcUrl: baseRpcUrl } = baseConfig;

  let solBalance: number | null = null;
  let usdcBalance: number | null = null;
  let ethBalance: number | null = null;
  let usdcBalanceBase: number | null = null;

  if (agent.walletAddress) {
    try {
      const [solRes, usdcRes] = await Promise.all([
        fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [agent.walletAddress] }),
        }),
        fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0", id: 2,
            method: "getTokenAccountsByOwner",
            params: [agent.walletAddress, { mint: usdcMint }, { encoding: "jsonParsed" }],
          }),
        }),
      ]);
      const solData = await solRes.json() as { result?: { value?: number } };
      solBalance = solData.result?.value != null ? solData.result.value / 1e9 : 0;
      const usdcData = await usdcRes.json() as { result?: { value?: { account: { data: { parsed: { info: { tokenAmount: { uiAmount: number } } } } } }[] } };
      const accounts = usdcData.result?.value ?? [];
      usdcBalance = accounts.length > 0 ? (accounts[0].account.data.parsed.info.tokenAmount.uiAmount ?? 0) : 0;
    } catch { /* RPC unavailable */ }
  }

  let baseRpcError: string | null = null;
  if (agent.walletAddressEvm) {
    try {
      const balances = await getBaseBalances(agent.walletAddressEvm, baseRpcUrl);
      ethBalance = balances.ethBalance;
      usdcBalanceBase = balances.usdcBalance;
    } catch (err) {
      baseRpcError = err instanceof Error ? err.message : String(err);
      console.error(`[wallet] Base RPC failed: ${baseRpcError}`);
    }
  }

  res.json({
    address: agent.walletAddress, solBalance, usdcBalance, network,
    addressEvm: agent.walletAddressEvm, ethBalance, usdcBalanceBase, baseNetwork,
    ...(baseRpcError ? { baseRpcError } : {}),
  });
});

// POST /api/agents/:id/wallet/export — decrypt and return Solana private key for manual use
agentRoutes.post("/:id/wallet/export", async (req, res) => {
  const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  if (!agent.walletKey) { res.status(404).json({ error: "No Solana wallet found" }); return; }
  try {
    const exported = await exportWalletKey(agent.walletKey);
    res.json({ address: agent.walletAddress, ...exported });
  } catch {
    res.status(500).json({ error: "Failed to decrypt wallet — check WALLET_ENCRYPTION_KEY" });
  }
});

// POST /api/agents/:id/wallet/export/evm — decrypt and return EVM private key for manual use
agentRoutes.post("/:id/wallet/export/evm", async (req, res) => {
  const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  if (!agent.walletKeyEvm) { res.status(404).json({ error: "No EVM wallet found" }); return; }
  try {
    const privateKey = await exportEvmWalletKey(agent.walletKeyEvm);
    res.json({ address: agent.walletAddressEvm, privateKey });
  } catch {
    res.status(500).json({ error: "Failed to decrypt EVM wallet — check WALLET_ENCRYPTION_KEY" });
  }
});

// POST /api/agents/:id/wallet — generate both Solana + EVM wallets if not already set
agentRoutes.post("/:id/wallet", async (req, res) => {
  const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: any = {};
  if (!agent.walletAddress) {
    const wallet = await generateWallet();
    updates.walletAddress = wallet.address;
    updates.walletKey = wallet.keyBytes;
  }
  if (!agent.walletAddressEvm) {
    const evmWallet = await generateEvmWallet();
    updates.walletAddressEvm = evmWallet.address;
    updates.walletKeyEvm = evmWallet.keyHex;
  }

  if (Object.keys(updates).length === 0) {
    res.json({ address: agent.walletAddress, addressEvm: agent.walletAddressEvm, existed: true });
    return;
  }

  const updated = await prisma.agent.update({ where: { id: req.params.id }, data: updates });
  res.json({ address: updated.walletAddress, addressEvm: updated.walletAddressEvm, existed: false });
});

// GET /api/agents/:id/invoke-info
agentRoutes.get("/:id/invoke-info", async (req, res) => {
  const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  const info = await buildInvokeInfo(req.params.id);
  res.json(info);
});

// GET /api/agents/:id/runs
agentRoutes.get("/:id/runs", async (req, res) => {
  const runs = await prisma.heartbeatRun.findMany({
    where: { agentId: req.params.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(runs);
});
