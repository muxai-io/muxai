import { describe, it, expect } from "vitest";
import { parseStreamJson, extractAssistantText, extractLastJson } from "../stream-parser";

// ── parseStreamJson ─────────────────────────────────────────────────

describe("parseStreamJson", () => {
  it("parses assistant text message", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello world" }] },
    });
    expect(parseStreamJson(line)).toEqual({ text: "Hello world" });
  });

  it("parses assistant tool_use", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "run_team", input: { task: "analyze BTC" } }],
      },
    });
    const result = parseStreamJson(line);
    expect(result.text).toContain("▶ run_team");
    expect(result.text).toContain("task=");
  });

  it("combines text and tool_use in one message", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Let me check" },
          { type: "tool_use", name: "ask_reporter", input: { name: "News Analyst" } },
        ],
      },
    });
    const result = parseStreamJson(line);
    expect(result.text).toContain("Let me check");
    expect(result.text).toContain("▶ ask_reporter");
  });

  it("returns null text for assistant with empty content", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [] },
    });
    expect(parseStreamJson(line)).toEqual({ text: null });
  });

  it("returns null text for assistant with whitespace-only text", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "   " }] },
    });
    expect(parseStreamJson(line)).toEqual({ text: null });
  });

  it("parses result with session_id", () => {
    const line = JSON.stringify({
      type: "result",
      result: "done",
      session_id: "sess-123",
    });
    expect(parseStreamJson(line)).toEqual({ text: null, sessionId: "sess-123" });
  });

  it("parses result error", () => {
    const line = JSON.stringify({
      type: "result",
      is_error: true,
      result: "something broke",
    });
    const result = parseStreamJson(line);
    expect(result.text).toBe("✗ something broke");
  });

  it("parses result with error subtype", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "error",
      result: "rate limited",
      session_id: "sess-456",
    });
    const result = parseStreamJson(line);
    expect(result.text).toBe("✗ rate limited");
    expect(result.sessionId).toBe("sess-456");
  });

  it("returns null text for unknown event types", () => {
    const line = JSON.stringify({ type: "system", data: "init" });
    expect(parseStreamJson(line)).toEqual({ text: null });
  });

  it("handles malformed JSON gracefully", () => {
    const result = parseStreamJson("not json at all");
    expect(result.text).toBe("not json at all");
  });

  it("returns null for empty/whitespace lines", () => {
    expect(parseStreamJson("")).toEqual({ text: null });
    expect(parseStreamJson("   ")).toEqual({ text: null });
  });

  it("truncates long tool input values", () => {
    const longValue = "x".repeat(200);
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "test_tool", input: { data: longValue } }],
      },
    });
    const result = parseStreamJson(line);
    // Input hints are sliced to 50 chars
    expect(result.text!.length).toBeLessThan(200);
  });
});

// ── extractAssistantText ────────────────────────────────────────────

describe("extractAssistantText", () => {
  it("extracts text from assistant messages", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Analysis complete" }] },
    });
    expect(extractAssistantText(line)).toBe("Analysis complete");
  });

  it("ignores tool_use blocks", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "run_team", input: {} }],
      },
    });
    expect(extractAssistantText(line)).toBeNull();
  });

  it("returns null for non-assistant types", () => {
    const line = JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "hi" }] } });
    expect(extractAssistantText(line)).toBeNull();
  });

  it("returns null for result type", () => {
    const line = JSON.stringify({ type: "result", result: "done" });
    expect(extractAssistantText(line)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(extractAssistantText("garbage")).toBeNull();
  });

  it("joins multiple text blocks", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Part 1" },
          { type: "text", text: "Part 2" },
        ],
      },
    });
    expect(extractAssistantText(line)).toBe("Part 1\nPart 2");
  });
});

// ── extractLastJson ─────────────────────────────────────────────────

describe("extractLastJson", () => {
  it("extracts JSON from fenced block", () => {
    const logs = 'Some text\n```json\n{"decision":"LONG"}\n```\nMore text';
    expect(extractLastJson(logs)).toEqual({ decision: "LONG" });
  });

  it("extracts last fenced block when multiple exist", () => {
    const logs = '```json\n{"first":true}\n```\ntext\n```json\n{"last":true}\n```';
    expect(extractLastJson(logs)).toEqual({ last: true });
  });

  it("extracts raw JSON object", () => {
    const logs = 'Some text {"decision":"WAIT","asset":"BTC"} more text';
    expect(extractLastJson(logs)).toEqual({ decision: "WAIT", asset: "BTC" });
  });

  it("extracts raw JSON array", () => {
    const logs = 'Stuff [1, 2, 3] end';
    expect(extractLastJson(logs)).toEqual([1, 2, 3]);
  });

  it("prefers last JSON when multiple raw objects exist", () => {
    const logs = '{"first":1} some text {"last":2}';
    expect(extractLastJson(logs)).toEqual({ last: 2 });
  });

  it("handles nested JSON", () => {
    // extractLastJson scans for all top-level { and [ candidates, tries last first.
    // The full object starting at index 0 is a valid candidate, but so is [1,2].
    // It returns the *last* valid JSON — which is the array here.
    const logs = '{"outer":{"inner":"value"},"arr":[1,2]}';
    expect(extractLastJson(logs)).toEqual([1, 2]);
  });

  it("returns inner object when nested objects exist", () => {
    // Inner {"inner":"value"} is a later candidate than the full object
    const logs = '{"outer":{"inner":"value"},"num":42}';
    expect(extractLastJson(logs)).toEqual({ inner: "value" });
  });

  it("returns full object when no nested objects", () => {
    const logs = '{"decision":"LONG","confidence":"high"}';
    expect(extractLastJson(logs)).toEqual({ decision: "LONG", confidence: "high" });
  });

  it("handles JSON with strings containing braces", () => {
    const logs = '{"text":"hello {world}","num":42}';
    expect(extractLastJson(logs)).toEqual({ text: "hello {world}", num: 42 });
  });

  it("handles JSON with escaped quotes in strings", () => {
    const logs = '{"text":"say \\"hello\\"","num":1}';
    expect(extractLastJson(logs)).toEqual({ text: 'say "hello"', num: 1 });
  });

  it("returns null when no JSON found", () => {
    expect(extractLastJson("no json here")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractLastJson("")).toBeNull();
  });

  it("handles trade decision format", () => {
    const tradeJson = {
      decision: "LONG",
      asset: "BTC/USDT",
      timeframe: "4h",
      entry: 65000.0,
      take_profit: 68000.0,
      stop_loss: 63500.0,
      risk_reward: "1:2",
      confidence: "high",
    };
    const logs = `Analysis complete.\n\`\`\`json\n${JSON.stringify(tradeJson, null, 2)}\n\`\`\``;
    expect(extractLastJson(logs)).toEqual(tradeJson);
  });

  it("skips invalid JSON in fenced blocks and falls back", () => {
    const logs = '```json\n{broken}\n```\ntext {"valid":true}';
    expect(extractLastJson(logs)).toEqual({ valid: true });
  });
});
