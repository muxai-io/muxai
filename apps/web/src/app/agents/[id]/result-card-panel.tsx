"use client";
import { useState } from "react";
import { Copy, Check, SlidersHorizontal, LayoutTemplate, ChevronDown, ChevronRight } from "lucide-react";
import { apiFetch } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CARD_TYPES, getCardDefinition, type ResultCardConfig, type CardSlot, type AutoResolveConfig, AUTO_RESOLVE_DEFAULTS } from "@/lib/result-cards";
import { ResultCard } from "@/components/result-card";
import { Switch } from "@/components/ui/switch";

// ─── Preview data + instruction generator ────────────────────────────────────

function slotPlaceholder(slot: CardSlot): unknown {
  switch (slot.type) {
    case "badge":    return slot.description ?? "VALUE";
    case "title":    return "Title";
    case "subtitle": return "Subtitle";
    case "tag":      return "tag";
    case "highlight":return 84500.00;
    case "metric":   return 0.00;
    case "delta":    return "+2.4%";
    case "body":     return "One sentence summary.";
    case "list":     return ["Item one", "Item two"];
  }
}

function buildPreviewData(cardType: string, mapping: Record<string, string>): Record<string, unknown> {
  const def = getCardDefinition(cardType);
  if (!def) return {};
  const data: Record<string, unknown> = {};
  for (const slot of def.slots) {
    const fieldName = mapping[slot.key]?.trim() || slot.key;
    data[fieldName] = slotPlaceholder(slot);
  }
  return data;
}

function buildInstruction(cardType: string, mapping: Record<string, string>): string {
  const def = getCardDefinition(cardType);
  if (!def) return "";
  const example: Record<string, unknown> = {};
  for (const slot of def.slots) {
    const fieldName = mapping[slot.key]?.trim() || slot.key;
    example[fieldName] = slotPlaceholder(slot);
  }
  return `At the end of your response, always output your result as a JSON block in exactly this format:\n\n\`\`\`json\n${JSON.stringify(example, null, 2)}\n\`\`\`\n\nDo not add extra fields or omit required fields. Output only one JSON block.`;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  agentId: string;
  adapterConfig: Record<string, unknown>;
  initialCardConfig?: ResultCardConfig;
}

export function ResultCardPanel({ agentId, adapterConfig, initialCardConfig }: Props) {
  const [cardType, setCardType] = useState(initialCardConfig?.type ?? "none");
  const [mapping, setMapping] = useState<Record<string, string>>(initialCardConfig?.mapping ?? {});
  const [autoResolve, setAutoResolve] = useState<AutoResolveConfig>(
    initialCardConfig?.autoResolve ?? { ...AUTO_RESOLVE_DEFAULTS },
  );
  const [open, setOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  function handleTypeChange(v: string) {
    setCardType(v);
    setMapping({});
    setMapOpen(false);
    setSaved(false);
    if (v === "trade-decision" && !initialCardConfig?.autoResolve) {
      setAutoResolve({ ...AUTO_RESOLVE_DEFAULTS });
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const resultCard = cardType !== "none"
        ? {
            type: cardType,
            mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v.trim())),
            ...(cardType === "trade-decision" ? { autoResolve } : {}),
          }
        : undefined;
      await apiFetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        body: JSON.stringify({ adapterConfig: { ...adapterConfig, resultCard } }),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(buildInstruction(cardType, mapping)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const def = getCardDefinition(cardType);
  const previewConfig: ResultCardConfig = { type: cardType, mapping };
  const previewData = def ? buildPreviewData(cardType, mapping) : {};

  return (
    <Card>
      <CardHeader className="cursor-pointer select-none p-4" onClick={() => setOpen((o) => !o)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LayoutTemplate className="h-4 w-4 text-violet-400" />
            <CardTitle className="text-sm">Result Card</CardTitle>
          </div>
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </CardHeader>
      {open && <CardContent className="space-y-4 px-4 pb-4 pt-0">
        {/* Card type selector */}
        <div className="space-y-1.5">
          <Label>Card Type</Label>
          <Select value={cardType} onValueChange={handleTypeChange}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No Result</SelectItem>
              <SelectItem value="raw">Raw JSON</SelectItem>
              {CARD_TYPES.map((c) => (
                <SelectItem key={c.type} value={c.type}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Card preview */}
        {def && (
          <ResultCard config={previewConfig} data={previewData} />
        )}

        {/* Auto-resolve config — trade-decision only */}
        {cardType === "trade-decision" && (
          <div className="space-y-2 rounded border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Auto-resolve outcomes</p>
                <p className="text-xs text-muted-foreground">Resolve Win/Loss against exchange candles after each decision. No user marking required.</p>
              </div>
              <Switch
                checked={autoResolve.enabled !== false}
                onCheckedChange={(v) => { setAutoResolve((c) => ({ ...c, enabled: v })); setSaved(false); }}
              />
            </div>
            {autoResolve.enabled !== false && (
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div className="space-y-1">
                  <Label className="text-xs">Exchange</Label>
                  <Select
                    value={autoResolve.exchange ?? AUTO_RESOLVE_DEFAULTS.exchange}
                    onValueChange={(v) => { setAutoResolve((c) => ({ ...c, exchange: v })); setSaved(false); }}
                  >
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="binance">Binance</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Expire after (bars)</Label>
                  <Input
                    className="h-7 text-xs"
                    type="number"
                    min={1}
                    value={autoResolve.expireBars ?? AUTO_RESOLVE_DEFAULTS.expireBars}
                    onChange={(e) => { setAutoResolve((c) => ({ ...c, expireBars: Number(e.target.value) || AUTO_RESOLVE_DEFAULTS.expireBars })); setSaved(false); }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Fill tolerance (%)</Label>
                  <Input
                    className="h-7 text-xs"
                    type="number"
                    step="0.05"
                    min={0}
                    value={autoResolve.fillTolerancePct ?? AUTO_RESOLVE_DEFAULTS.fillTolerancePct}
                    onChange={(e) => { setAutoResolve((c) => ({ ...c, fillTolerancePct: Number(e.target.value) })); setSaved(false); }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Field mapping (toggled) */}
        {def && mapOpen && (
          <div className="space-y-2 pt-1 border-t border-border">
            <p className="text-xs text-muted-foreground pt-2">Map your JSON output fields to card slots. Leave blank to use the default key name.</p>
            {def.slots.map((slot) => (
              <div key={slot.key} className="flex items-center gap-3">
                <div className="w-28 shrink-0">
                  <p className="text-xs font-medium leading-none">{slot.label}</p>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">{slot.key}{slot.optional ? "" : " *"}</p>
                </div>
                <Input
                  className="h-7 text-xs"
                  placeholder={slot.key}
                  value={mapping[slot.key] ?? ""}
                  onChange={(e) => { setMapping((m) => ({ ...m, [slot.key]: e.target.value })); setSaved(false); }}
                />
              </div>
            ))}
          </div>
        )}

        {/* Action buttons — always visible */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {def && (
            <Button size="sm" variant="outline" onClick={() => setMapOpen((o) => !o)}>
              <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" />
              {mapOpen ? "Hide Mapping" : "Map Output"}
            </Button>
          )}
          {def && (
            <Button size="sm" variant="outline" onClick={handleCopy}>
              {copied
                ? <><Check className="h-3.5 w-3.5 mr-1.5 text-emerald-400" />Copied!</>
                : <><Copy className="h-3.5 w-3.5 mr-1.5" />Copy Instructions</>
              }
            </Button>
          )}
          {saved && <span className="text-xs text-emerald-400">Saved</span>}
        </div>
      </CardContent>}
    </Card>
  );
}
