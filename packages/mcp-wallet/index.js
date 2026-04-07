#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { privateKeyToAccount } from "viem/accounts";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client, wrapAxiosWithPayment } from "@x402/axios";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import axios from "axios";

const server = new Server(
  { name: "wallet", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

function getApiUrl() { return process.env.MUXAI_API_URL || "http://localhost:3001"; }
function getAgentId() { return process.env.MUXAI_AGENT_ID; }
function internalHeaders() {
  const secret = process.env.MUXAI_INTERNAL_SECRET;
  return secret ? { "x-muxai-internal": secret } : {};
}
function log(msg) { process.stderr.write(`[wallet] ${msg}\n`); }

// Lazy-loaded — initialized on first tool call
let walletAddress = null;    // Solana
let walletAddressEvm = null; // Base/EVM
let paymentAxios = null;

async function initWallet() {
  if (paymentAxios) return;

  const agentId = getAgentId();
  if (!agentId) throw new Error("MUXAI_AGENT_ID not set — wallet MCP must run inside an agent process");

  const res = await fetch(`${getApiUrl()}/api/agents/${agentId}/wallet/key`, {
    headers: internalHeaders(),
  });

  if (res.status === 404) throw new Error("This agent has no wallet. Generate one from the agent detail page.");
  if (!res.ok) throw new Error(`Failed to fetch wallet key: ${res.status}`);

  let walletData;
  try { walletData = await res.json(); } catch { throw new Error("Invalid JSON from wallet key endpoint"); }
  const { address, keyBytes, addressEvm, keyHexEvm } = walletData;

  walletAddress = address;
  walletAddressEvm = addressEvm;

  const client = new x402Client();

  if (keyHexEvm && addressEvm) {
    const evmSigner = privateKeyToAccount(keyHexEvm);
    registerExactEvmScheme(client, { signer: evmSigner });
    log(`EVM wallet ready: ${addressEvm}`);
  }

  if (keyBytes && address) {
    const svmSigner = await createKeyPairSignerFromBytes(Uint8Array.from(keyBytes));
    registerExactSvmScheme(client, { signer: svmSigner });
    log(`Solana wallet ready: ${address}`);
  }

  paymentAxios = wrapAxiosWithPayment(axios.create(), client);
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "wallet_address",
      description: "Get this agent's wallet addresses. Returns Solana and Base/EVM addresses for receiving funds.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "wallet_fetch",
      description: "Make an HTTP request with automatic x402 payment support. If the server returns 402 Payment Required, the payment is made automatically from this agent's wallet (Base/EVM or Solana, routed automatically based on what the API requires) and the request is retried. Use this instead of regular HTTP calls when accessing paid APIs.",
      inputSchema: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", description: "The URL to request." },
          method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"], description: "HTTP method. Defaults to GET." },
          headers: { type: "object", description: "Optional request headers as key-value pairs.", additionalProperties: { type: "string" } },
          body: { type: "string", description: "Optional request body as a JSON string." },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  if (name === "wallet_address") {
    try {
      await initWallet();
      const lines = [];
      if (walletAddress) lines.push(`Solana: ${walletAddress}`);
      if (walletAddressEvm) lines.push(`Base (EVM): ${walletAddressEvm}`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }

  if (name === "wallet_fetch") {
    try {
      await initWallet();

      const { url, method = "GET", headers = {}, body } = args;
      log(`${method} ${url}`);

      let parsedBody;
      if (body) {
        try { parsedBody = JSON.parse(body); } catch { throw new Error("Invalid JSON in body parameter"); }
      }

      const response = await paymentAxios.request({
        url,
        method,
        headers,
        ...(parsedBody ? { data: parsedBody } : {}),
      });

      const text = typeof response.data === "string"
        ? response.data
        : JSON.stringify(response.data, null, 2);

      return {
        content: [{ type: "text", text: `Status: ${response.status}\n\n${text}` }],
      };
    } catch (err) {
      const msg = err.response
        ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`
        : err.message;
      log(`Error: ${msg}`);
      return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
    }
  }

  return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
});

const transport = new StdioServerTransport();
await server.connect(transport);
log("ready");
