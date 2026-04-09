import Link from "next/link";
import { notFound } from "next/navigation";
import { Terminal, ChevronLeft } from "lucide-react";
import { apiFetch } from "@/lib/utils";
import type { HeartbeatRun } from "@/lib/types";
import { RunStatusBadge } from "@/components/run-status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LiveLogs } from "@/components/live-logs";
import { RunResult } from "@/components/run-result";
import type { ResultCardConfig } from "@/lib/result-cards";

async function getRun(runId: string): Promise<HeartbeatRun | null> {
  try { return await apiFetch<HeartbeatRun>(`/api/runs/${runId}`); } catch { return null; }
}

export default async function RunDetailPage({ params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;
  const run = await getRun(runId);
  if (!run) notFound();

  const duration =
    run.startedAt && run.finishedAt
      ? Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
      : null;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="space-y-3">
        <Link href={`/agents/${id}/runs`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="h-3.5 w-3.5" />Run History
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-500/10 text-slate-400 shrink-0">
            <Terminal className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold leading-none font-mono">{run.id.slice(0, 8)}…</h1>
              <RunStatusBadge status={run.status} />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {run.startedAt ? new Date(run.startedAt).toLocaleString() : "—"}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Details</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Source" value={run.invocationSource} />
            <Row label="Exit code" value={run.exitCode !== null ? String(run.exitCode) : "—"} />
            {duration !== null && <Row label="Duration" value={`${duration}s`} />}
            {run.startedAt && <Row label="Started" value={new Date(run.startedAt).toLocaleString()} />}
            {run.finishedAt && <Row label="Finished" value={new Date(run.finishedAt).toLocaleString()} />}
          </CardContent>
        </Card>

        {run.errorMsg && (
          <Card className="border-destructive/50">
            <CardHeader><CardTitle className="text-sm text-destructive">Error</CardTitle></CardHeader>
            <CardContent>
              <pre className="text-xs whitespace-pre-wrap text-destructive">{run.errorMsg}</pre>
            </CardContent>
          </Card>
        )}
      </div>

      {run.resultJson && (
        <RunResult resultJson={run.resultJson} cardConfig={(run.agent?.adapterConfig as Record<string, unknown>)?.resultCard as ResultCardConfig | undefined} />
      )}

      <Card>
        <CardHeader><CardTitle className="text-sm">Logs</CardTitle></CardHeader>
        <CardContent>
          <LiveLogs
            runId={run.id}
            initialLogs={run.logs ?? ""}
            initialStatus={run.status}
            startedAt={run.startedAt}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
