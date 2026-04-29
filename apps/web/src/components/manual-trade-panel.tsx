"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { API_URL, API_KEY } from "@/lib/utils";

type Mode = "entry" | "exit";

export function ManualTradePanel({
  runId,
  mode,
  defaultPrice,
  hint,
}: {
  runId: string;
  mode: Mode;
  defaultPrice: number | null;
  hint?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [price, setPrice] = useState<string>(defaultPrice != null ? String(defaultPrice) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    const n = parseFloat(price);
    if (!Number.isFinite(n) || n <= 0) { setError("Enter a positive price"); return; }
    setBusy(true);
    try {
      const path = mode === "entry" ? "manual-entry" : "manual-exit";
      const body = mode === "entry" ? { fill: n } : { price: n };
      const res = await fetch(`${API_URL}/api/runs/${runId}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(API_KEY ? { "X-Api-Key": API_KEY } : {}) },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        setError(msg || `Failed to mark ${mode}`);
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  const Icon = mode === "entry" ? ArrowDownToLine : ArrowUpFromLine;
  const title = mode === "entry" ? "Mark Entered" : "Mark Exited";
  const label = mode === "entry" ? "Fill price" : "Exit price";
  const buttonText = mode === "entry" ? "Mark entered" : "Mark exited";
  const tone = mode === "entry"
    ? "border-amber-500/30 bg-amber-500/5"
    : "border-blue-500/30 bg-blue-500/5";
  const iconTone = mode === "entry" ? "text-amber-400" : "text-blue-400";

  return (
    <Card className={tone}>
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Icon className={`h-4 w-4 ${iconTone}`} />
          {title}
        </CardTitle>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-2">
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label className="text-xs">{label}</Label>
            <Input
              type="number"
              step="any"
              min={0}
              className="h-8 text-sm"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
              disabled={busy || pending}
            />
          </div>
          <Button size="sm" onClick={submit} disabled={busy || pending || !price.trim()}>
            {busy ? "Saving…" : buttonText}
          </Button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </CardContent>
    </Card>
  );
}
