import { describe, it, expect, beforeEach, vi } from "vitest";
import { trackProcess, getProcess, untrackProcess, stopProcess, isRunning, activeCount } from "../process-manager";
import { EventEmitter } from "events";

function mockChild() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    pid: Math.floor(Math.random() * 10000),
    kill: vi.fn().mockReturnValue(true),
    stdin: null,
    stdout: null,
    stderr: null,
    stdio: [null, null, null] as const,
    killed: false,
    connected: true,
    exitCode: null,
    signalCode: null,
    spawnargs: [],
    spawnfile: "",
    disconnect: vi.fn(),
    send: vi.fn(),
    ref: vi.fn(),
    unref: vi.fn(),
    [Symbol.dispose]: vi.fn(),
  }) as any;
}

describe("process-manager", () => {
  beforeEach(() => {
    // Clean up any tracked processes from prior tests
    // We don't export a clear() so we untrack by known IDs
  });

  it("tracks and retrieves a process", () => {
    const child = mockChild();
    trackProcess("run-1", child);
    expect(getProcess("run-1")).toBe(child);
    expect(isRunning("run-1")).toBe(true);
    // Cleanup
    untrackProcess("run-1");
  });

  it("returns undefined for unknown runId", () => {
    expect(getProcess("nonexistent")).toBeUndefined();
    expect(isRunning("nonexistent")).toBe(false);
  });

  it("untracks a process", () => {
    const child = mockChild();
    trackProcess("run-2", child);
    expect(isRunning("run-2")).toBe(true);
    untrackProcess("run-2");
    expect(isRunning("run-2")).toBe(false);
    expect(getProcess("run-2")).toBeUndefined();
  });

  it("stops a process — kills and removes from tracking", () => {
    const child = mockChild();
    trackProcess("run-3", child);
    const result = stopProcess("run-3");
    expect(result).toBe(true);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(isRunning("run-3")).toBe(false);
  });

  it("returns false when stopping unknown runId", () => {
    expect(stopProcess("nonexistent")).toBe(false);
  });

  it("counts active processes", () => {
    const before = activeCount();
    const child1 = mockChild();
    const child2 = mockChild();
    trackProcess("run-count-1", child1);
    trackProcess("run-count-2", child2);
    expect(activeCount()).toBe(before + 2);
    untrackProcess("run-count-1");
    untrackProcess("run-count-2");
    expect(activeCount()).toBe(before);
  });

  it("overwrites if same runId tracked twice", () => {
    const child1 = mockChild();
    const child2 = mockChild();
    trackProcess("run-dup", child1);
    trackProcess("run-dup", child2);
    expect(getProcess("run-dup")).toBe(child2);
    untrackProcess("run-dup");
  });
});
