export type SlotType = "badge" | "title" | "subtitle" | "highlight" | "body" | "list" | "metric" | "delta" | "tag";

export interface CardSlot {
  key: string;
  label: string;
  type: SlotType;
  description?: string;
  optional?: boolean;
}

export interface CardDefinition {
  type: string;
  label: string;
  description: string;
  slots: CardSlot[];
  // Re-examine capability — declarative, read by the platform.
  // false (default) hides the button; true always shows it; "until_resolved"
  // hides it once the run has a closed/expired resolutionStatus.
  reExaminable?: boolean | "until_resolved";
  // Domain action vocabulary for re-examinations — inlined into the prompt
  // so the model picks from the right enum for this card type.
  reExamineActions?: string[];
}

export interface AutoResolveConfig {
  enabled: boolean;
  exchange?: string;          // default "binance"
  expireBars?: number;        // default 24
  fillTolerancePct?: number;  // default 0.1
}

export interface ResultCardConfig {
  type: string;
  mapping: Record<string, string>; // slotKey → JSON field name
  autoResolve?: AutoResolveConfig; // only meaningful for trade-decision
}

export const AUTO_RESOLVE_DEFAULTS: Required<Omit<AutoResolveConfig, "enabled">> & { enabled: boolean } = {
  enabled: true,
  exchange: "binance",
  expireBars: 24,
  fillTolerancePct: 0.1,
};

export const CARD_TYPES: CardDefinition[] = [
  {
    type: "trade-decision",
    label: "Trade Decision",
    description: "Trading signal with entry, take profit, and stop loss levels",
    reExaminable: "until_resolved",
    reExamineActions: ["HOLD", "CLOSE", "SCALE"],
    slots: [
      { key: "decision", label: "Decision", type: "badge", description: "LONG / SHORT / WAIT" },
      { key: "asset", label: "Asset", type: "subtitle" },
      { key: "timeframe", label: "Timeframe", type: "tag", optional: true },
      { key: "confidence", label: "Confidence", type: "badge", optional: true },
      { key: "entry", label: "Entry", type: "metric", optional: true },
      { key: "take_profit", label: "Take Profit", type: "metric", optional: true },
      { key: "stop_loss", label: "Stop Loss", type: "metric", optional: true },
      { key: "risk_reward", label: "Risk:Reward", type: "metric", optional: true },
      { key: "consensus", label: "Consensus", type: "body", optional: true },
      { key: "invalidation", label: "Invalidation", type: "body", optional: true },
      { key: "watch_for", label: "Watch For", type: "list", optional: true },
      { key: "thesis_evolution", label: "Thesis Evolution", type: "body", optional: true, description: "Reflection on how this decision relates to prior calls" },
      { key: "previous_decisions", label: "Previous Decisions", type: "list", optional: true, description: "One-line summaries of recent prior calls (e.g. '2d ago · WAIT · range unresolved')" },
    ],
  },
  {
    type: "re-examination",
    label: "Re-examination",
    description: "Updated read on a prior decision: conviction score + notes + optional suggested action",
    slots: [
      { key: "target_run_id", label: "Re-examines", type: "subtitle", description: "ID of the parent run being re-evaluated" },
      { key: "conviction_score", label: "Conviction", type: "metric", description: "0-100. 0 = original conclusion fully invalidated, 100 = fully confirmed" },
      { key: "suggested_action", label: "Suggested Action", type: "badge", optional: true, description: "Domain-specific advisory string (e.g. HOLD/CLOSE/SCALE for trades). Advisory only — user decides." },
      { key: "notes", label: "Notes", type: "body", description: "One sentence on what changed since the original decision" },
      { key: "watch_for_review", label: "Watch-For Review", type: "list", optional: true, description: "Status of each prior watch-for item (played_out / failed / pending) — present only when the parent had watch_for" },
      { key: "event_verdict", label: "Event Gate", type: "badge", optional: true, description: "Copied from News Analyst when relevant" },
    ],
  },
];

// ─── Re-examine capability helpers ───────────────────────────────────────────

/** Whether the re-examine button should be shown for a parent run with the given card + resolution status. */
export function canReExamine(cardType: string | undefined, resolutionStatus: string | null | undefined): boolean {
  if (!cardType) return false;
  const def = getCardDefinition(cardType);
  if (!def?.reExaminable) return false;
  if (def.reExaminable === true) return true;
  // "until_resolved" — only allowed while the run is still active/pending
  return resolutionStatus === "active" || resolutionStatus === "pending";
}

export function getCardDefinition(type: string): CardDefinition | undefined {
  return CARD_TYPES.find((c) => c.type === type);
}

// Resolve a slot value from data using the mapping (falls back to slot key)
export function resolveSlot(slotKey: string, mapping: Record<string, string>, data: Record<string, unknown>): unknown {
  const fieldName = mapping[slotKey] || slotKey;
  return data[fieldName];
}
