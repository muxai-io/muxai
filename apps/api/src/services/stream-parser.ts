// ── Stream JSON parsing ─────────────────────────────────────────────
// Shared parsers for Claude CLI --output-format stream-json output.

export interface ParsedStreamLine {
  text: string | null;
  sessionId?: string;
}

/**
 * Parse a single stream-json line into human-readable text.
 * Returns sessionId when a "result" event carries one (for --resume support).
 */
export function parseStreamJson(line: string): ParsedStreamLine {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;

    if (obj.type === "assistant") {
      const msg = obj.message as { content?: unknown[] } | undefined;
      const parts: string[] = [];
      for (const block of msg?.content ?? []) {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
          parts.push(b.text.trim());
        }
        if (b.type === "tool_use") {
          const input = b.input as Record<string, unknown> | undefined;
          const hint = input
            ? Object.entries(input)
                .slice(0, 2)
                .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 50)}`)
                .join(", ")
            : "";
          parts.push(`▶ ${b.name}${hint ? `(${hint})` : ""}`);
        }
      }
      return { text: parts.length ? parts.join("\n") : null };
    }

    if (obj.type === "result") {
      const r = obj as { subtype?: string; result?: string; is_error?: boolean; session_id?: string };
      const sessionId = r.session_id;
      if (r.is_error || r.subtype === "error") return { text: `✗ ${r.result ?? "unknown error"}`, sessionId };
      return { text: null, sessionId };
    }

    return { text: null };
  } catch {
    return { text: line.trim() || null };
  }
}

/**
 * Extract only the text content from assistant messages.
 * Excludes tool results and user turns — used for result card extraction
 * so that reporter JSON returned via tool results doesn't get picked up.
 */
export function extractAssistantText(line: string): string | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;
    if (obj.type !== "assistant") return null;
    const msg = obj.message as { content?: unknown[] } | undefined;
    const parts: string[] = [];
    for (const block of msg?.content ?? []) {
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
        parts.push(b.text.trim());
      }
    }
    return parts.length ? parts.join("\n") : null;
  } catch {
    return null;
  }
}

/**
 * Extract the last valid JSON object or array from a log string.
 * Handles both raw JSON blocks and ```json fenced blocks.
 */
export function extractLastJson(logs: string): unknown | null {
  // Try fenced blocks first (```json ... ```)
  const fenced = [...logs.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  for (let i = fenced.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(fenced[i][1].trim());
    } catch {
      /* continue */
    }
  }
  // Fall back: find all balanced JSON objects/arrays, try from last to first.
  const candidates: { start: number; end: number }[] = [];
  for (let i = 0; i < logs.length; i++) {
    if (logs[i] !== "{" && logs[i] !== "[") continue;
    const open = logs[i];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let j = i; j < logs.length; j++) {
      if (escape) {
        escape = false;
        continue;
      }
      if (logs[j] === "\\" && inString) {
        escape = true;
        continue;
      }
      if (logs[j] === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (logs[j] === open) depth++;
      else if (logs[j] === close) {
        if (--depth === 0) {
          candidates.push({ start: i, end: j });
          break;
        }
      }
    }
  }
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(logs.slice(candidates[i].start, candidates[i].end + 1));
    } catch {
      /* continue */
    }
  }
  return null;
}
