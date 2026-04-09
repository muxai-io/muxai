import type { ChildProcess } from "child_process";

// ── Unified process tracker ─────────────────────────────────────────
// Single Map replaces the 3 separate Maps in heartbeat.ts, chat.ts, sandbox.ts.
// Also addresses the memory leak bug — stuck processes get cleaned up on interval.

const processes = new Map<string, { child: ChildProcess; startedAt: number }>();

/** Track a running process by runId. */
export function trackProcess(runId: string, child: ChildProcess): void {
  processes.set(runId, { child, startedAt: Date.now() });
}

/** Get a tracked process by runId. */
export function getProcess(runId: string): ChildProcess | undefined {
  return processes.get(runId)?.child;
}

/** Remove a process from tracking (called on close/error). */
export function untrackProcess(runId: string): void {
  processes.delete(runId);
}

/** Stop a process by runId. Returns true if found and killed. */
export function stopProcess(runId: string): boolean {
  const entry = processes.get(runId);
  if (!entry) return false;
  entry.child.kill("SIGTERM");
  processes.delete(runId);
  return true;
}

/** Check if a runId has an active process. */
export function isRunning(runId: string): boolean {
  return processes.has(runId);
}

/** Get count of active processes. */
export function activeCount(): number {
  return processes.size;
}

// ── Stale process cleanup ───────────────────────────────────────────
// Sweep every 5 minutes — kill processes older than 2 hours that haven't exited.
// This prevents the memory leak where stuck processes stay in the Map forever.

const MAX_PROCESS_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

setInterval(() => {
  const now = Date.now();
  for (const [runId, entry] of processes) {
    if (now - entry.startedAt > MAX_PROCESS_AGE_MS) {
      console.warn(`[process-manager] Killing stale process for run ${runId} (age: ${Math.round((now - entry.startedAt) / 60000)}m)`);
      entry.child.kill("SIGTERM");
      processes.delete(runId);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();
