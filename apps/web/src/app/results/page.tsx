import { apiFetch } from "@/lib/utils";
import type { HeartbeatRun } from "@/lib/types";
import { ResultsTerminal } from "./terminal";

async function getRunsWithResults(): Promise<HeartbeatRun[]> {
  try { return await apiFetch<HeartbeatRun[]>("/api/runs?withResults=true&limit=200"); } catch { return []; }
}

export default async function ResultsPage() {
  const runs = await getRunsWithResults();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Results</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Trade decisions, live monitoring, and resolved outcomes.</p>
      </div>
      <ResultsTerminal runs={runs} />
    </div>
  );
}
