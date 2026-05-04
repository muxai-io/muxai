// Builds the runtime prompt for a re-examination run. Server-built and
// authoritative — overrides whatever the agent's SKILL.md says about output
// format, so re-examine works on any agent without SKILL.md cooperation.
//
// Generic by design: iterates the parent's resolved slot values, never
// branches on card type. Domain richness comes from the parent's slots
// (a trade-decision parent naturally produces a trade-flavored prompt
// because it has entry/tp/sl/watch_for slots; other card types produce
// their own flavor with no platform code changes).

// Per-card-type re-examine action vocabulary. Mirrors the
// `reExamineActions` field in `apps/web/src/lib/result-cards.ts` —
// keep these in sync until we have a shared package.
const RE_EXAMINE_ACTIONS_BY_CARD_TYPE: Record<string, string[]> = {
  "trade-decision": ["HOLD", "CLOSE", "SCALE"],
};

interface BuildArgs {
  parentRunId: string;
  parentCardType: string;
  parentResultJson: Record<string, unknown>;
  parentMapping: Record<string, string>;
  parentDecidedAt: Date | null;
}

function formatSlotValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) return v.map((x) => `\n      • ${typeof x === "string" ? x : JSON.stringify(x)}`).join("");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function ageDescription(decidedAt: Date | null): string {
  if (!decidedAt) return "unknown time ago";
  const ms = Date.now() - decidedAt.getTime();
  const hours = Math.round(ms / (1000 * 60 * 60));
  if (hours < 1) return "less than an hour ago";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function buildReExaminePrompt(args: BuildArgs): string {
  const { parentRunId, parentCardType, parentResultJson, parentMapping, parentDecidedAt } = args;

  // Resolve every slot on the parent's resultJson via its mapping.
  // The mapping keys are slot keys; values are the JSON field name to read.
  // Fall back to the slot key itself when no mapping override is set.
  const resolvedSlots: Array<[string, unknown]> = [];
  const seen = new Set<string>();
  for (const [slotKey, fieldName] of Object.entries(parentMapping)) {
    const v = parentResultJson[fieldName] ?? parentResultJson[slotKey];
    resolvedSlots.push([slotKey, v]);
    seen.add(slotKey);
    seen.add(fieldName);
  }
  // Also include any top-level fields in resultJson that weren't covered by the mapping
  for (const [k, v] of Object.entries(parentResultJson)) {
    if (seen.has(k)) continue;
    resolvedSlots.push([k, v]);
  }

  const slotsBlock = resolvedSlots
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `  ${k}: ${formatSlotValue(v)}`)
    .join("\n");

  const actions = RE_EXAMINE_ACTIONS_BY_CARD_TYPE[parentCardType] ?? [];
  const actionEnum = actions.length > 0
    ? actions.map((a) => `"${a}"`).join(" | ")
    : `"<one short uppercase string appropriate for this domain>"`;
  const actionGuidance = actions.length > 0
    ? `Must be one of: ${actionEnum}. Advisory only — the user decides whether to act on it.`
    : `Free-form short uppercase string. Advisory only — the user decides whether to act on it.`;

  // The parent had a `watch_for` slot — ask the model to grade each item.
  const hasWatchFor = "watch_for" in parentResultJson || resolvedSlots.some(([k]) => k === "watch_for");
  const watchForReviewSpec = hasWatchFor
    ? `,
  "watch_for_review": [
    { "item": "<verbatim watch-for line from the previous conclusion>", "status": "played_out" | "failed" | "pending", "evidence": "<one sentence citing which specialist's finding supports the status>" }
  ]`
    : "";

  return `RE-EXAMINE MODE — output format override

This run is a re-evaluation of an earlier conclusion produced by you.
Disregard any prior instructions in your system prompt about producing
a ${parentCardType} JSON block. The ONLY valid output for this run is
the re-examination JSON specified at the end of this prompt.

Previous conclusion (runId: ${parentRunId}, decided ${ageDescription(parentDecidedAt)}):
${slotsBlock}

Run your usual analysis as you would for a fresh decision (invoke your
full team / specialists, gather their outputs, synthesize). Then output
EXACTLY ONE JSON block in this format and nothing else:

\`\`\`json
{
  "target_run_id": "${parentRunId}",
  "conviction_score": <integer 0-100, where 0 = original conclusion fully invalidated, 100 = fully confirmed>,
  "suggested_action": ${actionEnum},
  "notes": "<one sentence on what changed since the original decision>"${watchForReviewSpec}
}
\`\`\`

Notes on each field:
- conviction_score: how strongly does the fresh analysis still support the original conclusion?
- suggested_action: ${actionGuidance}
- notes: keep to one sentence. The interesting reasoning belongs in your normal response text above the JSON; this field is the executive summary.

Do not produce any other JSON blocks. Do not produce a ${parentCardType} block.`;
}
