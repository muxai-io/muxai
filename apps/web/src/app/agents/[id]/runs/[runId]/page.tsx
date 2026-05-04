import Link from "next/link";
import { notFound } from "next/navigation";
import { Terminal, ChevronLeft } from "lucide-react";
import { apiFetch } from "@/lib/utils";
import type { HeartbeatRun } from "@/lib/types";
import { RunStatusBadge } from "@/components/run-status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LiveLogs } from "@/components/live-logs";
import { RunResult } from "@/components/run-result";
import { OutcomePicker } from "@/components/outcome-picker";
import { ManualTradePanel } from "@/components/manual-trade-panel";
import { ReExamineButton } from "@/components/re-examine-button";
import { canReExamine, type ResultCardConfig } from "@/lib/result-cards";

async function getRun(runId: string): Promise<HeartbeatRun | null> {
  try { return await apiFetch<HeartbeatRun>(`/api/runs/${runId}`); } catch { return null; }
}

async function getSiblingRuns(agentId: string): Promise<HeartbeatRun[]> {
  try { return await apiFetch<HeartbeatRun[]>(`/api/agents/${agentId}/runs`); } catch { return []; }
}

async function getReExaminations(parentRunId: string): Promise<HeartbeatRun[]> {
  try { return await apiFetch<HeartbeatRun[]>(`/api/runs/${parentRunId}/re-examinations`); } catch { return []; }
}

// Re-examination runs override their agent's normal card with the generic
// `re-examination` card. Detected by the presence of `parentRunId`.
function resolveCardConfig(run: HeartbeatRun): ResultCardConfig | undefined {
  if (run.parentRunId) {
    return { type: "re-examination", mapping: {} };
  }
  return (run.agent?.adapterConfig as Record<string, unknown>)?.resultCard as ResultCardConfig | undefined;
}

export default async function RunDetailPage({ params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;
  const run = await getRun(runId);
  if (!run) notFound();

  const siblings = await getSiblingRuns(id);
  const pastLabels = Array.from(
    new Set(
      siblings
        .map((r) => r.outcome)
        .filter((o): o is string => typeof o === "string" && o.trim().length > 0),
    ),
  );

  // Children render under the parent as a chronological conviction history.
  // Skip the fetch for re-examination runs themselves (they don't have children today).
  const reExaminations = !run.parentRunId ? await getReExaminations(run.id) : [];

  const card = (run.agent?.adapterConfig as Record<string, unknown>)?.resultCard as ResultCardConfig | undefined;
  const reExamineAllowed = !run.parentRunId && canReExamine(card?.type, run.resolutionStatus);

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

      <div className="rounded-lg border border-border bg-card/40 px-4 py-2.5 flex items-center gap-x-5 gap-y-1.5 flex-wrap">
        <Meta label="Source" value={run.invocationSource} />
        <Meta label="Exit" value={run.exitCode !== null ? String(run.exitCode) : "—"} />
        {duration !== null && <Meta label="Duration" value={`${duration}s`} />}
        {run.startedAt && <Meta label="Started" value={new Date(run.startedAt).toLocaleString()} />}
        {run.finishedAt && <Meta label="Finished" value={new Date(run.finishedAt).toLocaleString()} />}
      </div>

      {run.errorMsg && (
        <Card className="border-destructive/50">
          <CardHeader><CardTitle className="text-sm text-destructive">Error</CardTitle></CardHeader>
          <CardContent>
            <pre className="text-xs whitespace-pre-wrap text-destructive">{run.errorMsg}</pre>
          </CardContent>
        </Card>
      )}

      {run.resultJson && (
        <section className="space-y-3">
          <h2 className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Tracking &amp; outcome</h2>
          <AutoResolveStatus run={run} />
          {isAutoResolveActive(run) && (run.resolutionStatus === "pending" || run.resolutionStatus === "active") && (
            <ManualTradeSection run={run} />
          )}
          <OutcomePicker
            runId={run.id}
            initialOutcome={run.outcome}
            initialFields={run.outcomeFields}
            pastLabels={pastLabels}
            autoResolveActive={isAutoResolveActive(run)}
          />
          {reExamineAllowed && (
            <div className="flex items-center gap-3 pt-1">
              <ReExamineButton parentRunId={run.id} />
              <span className="text-[11px] text-muted-foreground">Re-run the full team to update conviction on this decision.</span>
            </div>
          )}
        </section>
      )}

      {run.parentRunId && (
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardContent className="p-3 text-sm flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground">Re-examines</span>
            <Link
              href={`/agents/${id}/runs/${run.parentRunId}`}
              className="font-mono text-blue-400 hover:underline"
            >
              {run.parentRunId.slice(0, 8)}…
            </Link>
          </CardContent>
        </Card>
      )}

      {reExaminations.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Conviction history · {reExaminations.length}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {reExaminations.map((r) => (
              <ReExaminationRow key={r.id} run={r} agentId={id} />
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {run.resultJson && (
            <details open className="group">
              <summary className="cursor-pointer list-none flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-foreground/[0.02] transition-colors">
                <span>Result</span>
                <span className="text-muted-foreground text-xs group-open:rotate-90 transition-transform">▸</span>
              </summary>
              <div className="px-4 pb-4">
                <RunResult
                  resultJson={run.resultJson}
                  cardConfig={resolveCardConfig(run)}
                  compact
                />
              </div>
            </details>
          )}
          {run.resultJson && <div className="border-t border-border" />}
          <details className="group">
            <summary className="cursor-pointer list-none flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-foreground/[0.02] transition-colors">
              <span>Logs</span>
              <span className="text-muted-foreground text-xs group-open:rotate-90 transition-transform">▸</span>
            </summary>
            <div className="px-4 pb-4">
              <LiveLogs
                runId={run.id}
                initialLogs={run.logs ?? ""}
                initialStatus={run.status}
                startedAt={run.startedAt}
              />
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}

function ReExaminationRow({ run, agentId }: { run: HeartbeatRun; agentId: string }) {
  const result = (run.resultJson ?? {}) as Record<string, unknown>;
  const score = typeof result.conviction_score === "number" ? result.conviction_score : null;
  const action = typeof result.suggested_action === "string" ? result.suggested_action : null;
  const notes = typeof result.notes === "string" ? result.notes : null;
  const when = run.finishedAt ? new Date(run.finishedAt).toLocaleString() : "running…";

  const tone = score === null
    ? "text-muted-foreground"
    : score >= 70 ? "text-emerald-400"
    : score >= 40 ? "text-amber-400"
    : "text-red-400";

  return (
    <Link
      href={`/agents/${agentId}/runs/${run.id}`}
      className="block rounded-md border border-border bg-card/40 px-3 py-2 hover:bg-foreground/[0.02] transition-colors"
    >
      <div className="flex items-center gap-3 text-sm">
        <span className={`font-mono font-semibold ${tone}`}>
          {score !== null ? `${score}` : "—"}
        </span>
        {action && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-muted text-muted-foreground">
            {action}
          </span>
        )}
        <span className="text-xs text-muted-foreground font-mono">{when}</span>
      </div>
      {notes && <div className="text-xs text-muted-foreground mt-1">{notes}</div>}
    </Link>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 text-xs">
      <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground/70">{label}</span>
      <span className="text-foreground/90 font-mono">{value}</span>
    </span>
  );
}

function ManualTradeSection({ run }: { run: HeartbeatRun }) {
  const adapter = (run.agent?.adapterConfig ?? {}) as Record<string, unknown>;
  const card = adapter.resultCard as { mapping?: Record<string, string> } | undefined;
  const mapping = card?.mapping ?? {};
  const k = (slot: string) => mapping[slot]?.trim() || slot;
  const result = (run.resultJson ?? {}) as Record<string, unknown>;
  const num = (key: string): number | null => {
    const v = result[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }
    return null;
  };

  if (run.resolutionStatus === "pending") {
    return (
      <ManualTradePanel
        runId={run.id}
        mode="entry"
        defaultPrice={num(k("entry"))}
        hint="Price is close but didn't quite tag the level — record the actual fill you got."
      />
    );
  }

  // active — offer Mark Exited (and still allow re-marking entry to correct slip)
  const meta = (run.resolutionMeta ?? {}) as Record<string, unknown>;
  const manualEntry = meta.manualEntry && typeof meta.manualEntry === "object"
    ? meta.manualEntry as { fill?: number }
    : null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ManualTradePanel
        runId={run.id}
        mode="entry"
        defaultPrice={manualEntry?.fill ?? num(k("entry"))}
        hint="Adjust the fill price if you got slippage on entry."
      />
      <ManualTradePanel
        runId={run.id}
        mode="exit"
        defaultPrice={num(k("take_profit"))}
        hint="Cutting early or filled with slippage? Record the real exit."
      />
    </div>
  );
}

function isAutoResolveActive(run: HeartbeatRun): boolean {
  const adapter = (run.agent?.adapterConfig ?? {}) as Record<string, unknown>;
  const card = adapter.resultCard as { type?: string; autoResolve?: { enabled?: boolean } } | undefined;
  if (!card || card.type !== "trade-decision") return false;
  return card.autoResolve?.enabled !== false;
}

function AutoResolveStatus({ run }: { run: HeartbeatRun }) {
  const fields = (run.outcomeFields ?? {}) as Record<string, unknown>;
  const source = typeof fields.source === "string" ? fields.source : null;
  const status = run.resolutionStatus;
  const meta = (run.resolutionMeta ?? {}) as Record<string, unknown>;

  if (!status && source !== "auto") return null;

  if (status === "active") {
    const enteredAt = typeof meta.enteredAt === "number" ? new Date(meta.enteredAt).toLocaleString() : null;
    return (
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="p-3 text-sm flex items-center gap-3">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
          <span className="font-medium">Active</span>
          <span className="text-muted-foreground">{enteredAt ? `entered ${enteredAt}` : "watching market"} · awaiting TP/SL</span>
        </CardContent>
      </Card>
    );
  }

  if (status === "pending") {
    return (
      <Card className="border-slate-500/30 bg-slate-500/5">
        <CardContent className="p-3 text-sm flex items-center gap-3">
          <span className="inline-block h-2 w-2 rounded-full bg-slate-400" />
          <span className="font-medium">Pending</span>
          <span className="text-muted-foreground">waiting for entry price</span>
        </CardContent>
      </Card>
    );
  }

  if (source === "auto" && (status === "resolved" || status === "expired")) {
    const r = typeof fields.r_multiple === "number" ? fields.r_multiple : null;
    const exit = typeof fields.exit_price === "number" ? fields.exit_price : null;
    const reason = typeof meta.reason === "string" ? meta.reason : null;
    const reasonText = reason === "tp_hit" ? "TP hit" : reason === "sl_hit" ? "SL hit" : reason === "same_bar_collision" ? "same-bar collision (conservative loss)" : reason === "no_fill_expired" ? "expired without fill" : reason === "no_resolution_expired" ? "expired before resolution" : reason;
    const tone = run.outcome === "Win" ? "border-emerald-500/30 bg-emerald-500/5" : run.outcome === "Loss" ? "border-red-500/30 bg-red-500/5" : "border-slate-500/30 bg-slate-500/5";
    const dot = run.outcome === "Win" ? "bg-emerald-400" : run.outcome === "Loss" ? "bg-red-400" : "bg-slate-400";
    return (
      <Card className={tone}>
        <CardContent className="p-3 text-sm flex items-center gap-3 flex-wrap">
          <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
          <span className="font-medium">Auto · {run.outcome}</span>
          {r !== null && <span className="text-muted-foreground">{r >= 0 ? "+" : ""}{r}R</span>}
          {exit !== null && <span className="text-muted-foreground">exit @ {exit}</span>}
          {reasonText && <span className="text-muted-foreground">· {reasonText}</span>}
        </CardContent>
      </Card>
    );
  }

  return null;
}
