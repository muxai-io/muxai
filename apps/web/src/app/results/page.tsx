import Link from "next/link";
import { ChevronRight, FileJson } from "lucide-react";
import { apiFetch } from "@/lib/utils";
import type { HeartbeatRun } from "@/lib/types";
import { RunResult } from "@/components/run-result";
import { RunStatusBadge } from "@/components/run-status-badge";
import type { ResultCardConfig } from "@/lib/result-cards";

async function getRunsWithResults(): Promise<HeartbeatRun[]> {
  try { return await apiFetch<HeartbeatRun[]>("/api/runs?withResults=true&limit=50"); } catch { return []; }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function ResultsPage() {
  const runs = await getRunsWithResults();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Results</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Structured outputs captured from agent runs</p>
      </div>

      {runs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-24 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
            <FileJson className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">No results yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Results appear when an agent outputs a JSON block at the end of a run
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {runs.map((run) => (
            <div key={run.id} className="space-y-2">
              {/* Run header */}
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{run.agent?.name ?? "—"}</span>
                  <RunStatusBadge status={run.status} />
                  <span className="text-xs text-muted-foreground font-mono">{run.id.slice(0, 8)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{timeAgo(run.createdAt)}</span>
                  <Link
                    href={`/agents/${run.agentId}/runs/${run.id}`}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    View run <ChevronRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>
              {/* Result card */}
              {run.resultJson && (
                <RunResult
                  resultJson={run.resultJson}
                  cardConfig={run.agent?.adapterConfig?.resultCard as ResultCardConfig | undefined}
                  compact
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
