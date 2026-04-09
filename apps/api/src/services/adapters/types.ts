import type { ChildProcess } from "child_process";

// ── Adapter interface ───────────────────────────────────────────────
// Defines how an agent gets invoked. ClaudeLocal is the default.
// Future adapters: ElizaOS, OpenRouter, A2A remote agents.

/** Minimal agent shape needed by adapters — avoids coupling to Prisma types. */
export interface AdapterAgent {
  id: string;
  name: string;
  role: string;
  capabilities?: string | null;
  adapterConfig: Record<string, unknown>;
  reports: { id: string; name: string; role: string; adapterConfig: unknown }[];
}

/** What the adapter produces for spawning. */
export interface SpawnConfig {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

/** Callbacks the spawn caller provides to handle process events. */
export interface SpawnCallbacks {
  onStdoutLine: (line: string) => void;
  onStderrLine: (line: string) => void;
  onClose: (code: number | null) => void;
  onError: (err: Error) => void;
}

/** The contract every adapter must implement. */
export interface Adapter {
  readonly type: string;

  /** Build CLI args + env without spawning — used for invoke-info preview. */
  buildSpawnConfig(agent: AdapterAgent, opts: {
    promptOverride?: string;
    runId?: string;
    isPreview?: boolean;
  }): Promise<SpawnConfig>;

  /** Spawn a process and wire up callbacks. Returns the child process. */
  spawn(config: SpawnConfig, callbacks: SpawnCallbacks): ChildProcess;
}

// ── Adapter registry ────────────────────────────────────────────────

const adapters = new Map<string, Adapter>();

export function registerAdapter(adapter: Adapter): void {
  adapters.set(adapter.type, adapter);
}

export function getAdapter(type: string): Adapter {
  const adapter = adapters.get(type);
  if (!adapter) throw new Error(`Unknown adapter type: "${type}". Registered: [${[...adapters.keys()].join(", ")}]`);
  return adapter;
}
