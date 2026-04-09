import { describe, it, expect } from "vitest";
import { registerAdapter, getAdapter } from "../types";
import type { Adapter } from "../types";

describe("adapter registry", () => {
  it("registers and retrieves an adapter", () => {
    const mock: Adapter = {
      type: "test_adapter",
      buildSpawnConfig: async () => ({ command: "echo", args: [], cwd: ".", env: {} }),
      spawn: () => null as any,
    };
    registerAdapter(mock);
    expect(getAdapter("test_adapter")).toBe(mock);
  });

  it("throws for unknown adapter type", () => {
    expect(() => getAdapter("nonexistent_adapter_xyz")).toThrowError("Unknown adapter type");
  });

  it("includes registered types in error message", () => {
    try {
      getAdapter("bad_type_for_error_test");
    } catch (e: any) {
      // Should list at least claude_local (registered by import side-effect)
      expect(e.message).toContain("Registered:");
    }
  });

  it("overwrites adapter on re-register", () => {
    const v1: Adapter = {
      type: "overwrite_test",
      buildSpawnConfig: async () => ({ command: "v1", args: [], cwd: ".", env: {} }),
      spawn: () => null as any,
    };
    const v2: Adapter = {
      type: "overwrite_test",
      buildSpawnConfig: async () => ({ command: "v2", args: [], cwd: ".", env: {} }),
      spawn: () => null as any,
    };
    registerAdapter(v1);
    registerAdapter(v2);
    expect(getAdapter("overwrite_test")).toBe(v2);
  });
});
