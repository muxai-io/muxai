"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResultCard } from "@/components/result-card";
import type { ResultCardConfig } from "@/lib/result-cards";

function JsonViewer({ json }: { json: Record<string, unknown> }) {
  return (
    <pre className="text-xs font-mono text-foreground/80 bg-muted/50 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-all">
      {JSON.stringify(json, null, 2)}
    </pre>
  );
}

export function RunResult({
  resultJson,
  cardConfig,
  compact,
}: {
  resultJson: Record<string, unknown>;
  cardConfig?: ResultCardConfig;
  compact?: boolean;
}) {
  const inner = cardConfig && cardConfig.type !== "none" && cardConfig.type !== "raw" ? (
    <ResultCard config={cardConfig} data={resultJson} />
  ) : (
    <JsonViewer json={resultJson} />
  );

  if (compact) return inner;

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Result</CardTitle></CardHeader>
      <CardContent>{inner}</CardContent>
    </Card>
  );
}
