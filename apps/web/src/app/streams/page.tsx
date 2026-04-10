"use client";
import { useEffect, useState } from "react";
import { useLogStream, agentColor } from "@/components/log-stream-context";
import { LogLine } from "@/components/global-log-panel";
import { apiFetch } from "@/lib/utils";
import type { LogEntry } from "@/components/log-stream-context";
import { Radio, AlignJustify, Columns2 } from "lucide-react";

interface HistoryRun {
  id: string;
  agentId: string;
  status: string;
  logs: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  agent: { id: string; name: string; role: string };
}

let historyId = -1;

function runToEntries(run: HistoryRun): LogEntry[] {
  const entries: LogEntry[] = [];
  const ts = run.startedAt ? new Date(run.startedAt).getTime() : Date.now();
  const endTs = run.finishedAt ? new Date(run.finishedAt).getTime() : ts;

  entries.push({ id: historyId--, ts, agentId: run.agentId, agentName: run.agent.name, kind: "run_start", content: "started" });

  if (run.logs) {
    const lines = run.logs.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      entries.push({
        id: historyId--,
        ts,
        agentId: run.agentId,
        agentName: run.agent.name,
        kind: line.startsWith("▶") ? "tool" : "text",
        content: line,
      });
    }
  }

  const succeeded = run.status === "succeeded";
  entries.push({
    id: historyId--,
    ts: endTs,
    agentId: run.agentId,
    agentName: run.agent.name,
    kind: "run_end",
    content: run.status,
    status: succeeded ? "succeeded" : "failed",
  });

  return entries;
}

export default function StreamsPage() {
  const { entries, activeRuns, clear } = useLogStream();
  const [history, setHistory] = useState<LogEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showTime, setShowTime] = useState(true);
  const [showName, setShowName] = useState(true);
  const [splitView, setSplitView] = useState(false);

  useEffect(() => {
    apiFetch<HistoryRun[]>(`/api/runs?persistedOnly=true&limit=50`)
      .then((runs) => {
        const all = runs.flatMap(runToEntries);
        setHistory(all);
      })
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, []);

  // All entries combined, oldest-first for split columns
  const allEntries = [...entries, ...history];

  // Unique agents ordered by first appearance
  const agents = Array.from(
    allEntries.reduce((map, e) => {
      if (!map.has(e.agentId)) map.set(e.agentId, e.agentName);
      return map;
    }, new Map<string, string>())
  ).map(([agentId, agentName]) => ({ agentId, agentName }));

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
            <Radio className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-none">Stream History</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {activeRuns > 0 ? (
                <span className="flex items-center gap-1.5 text-blue-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
                  {activeRuns} agent{activeRuns > 1 ? "s" : ""} running
                </span>
              ) : "Live agent output and run history"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSplitView(false)}
            title="Combined view"
            className={`p-1.5 rounded border transition-colors ${!splitView ? "border-border bg-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <AlignJustify className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setSplitView(true)}
            title="Split by agent"
            className={`p-1.5 rounded border transition-colors ${splitView ? "border-border bg-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <Columns2 className="h-3.5 w-3.5" />
          </button>
          <div className="w-px h-4 bg-border mx-1" />
          <button onClick={() => setShowTime((v) => !v)} className={`text-xs px-2 py-1 rounded border transition-colors ${showTime ? "border-border bg-accent text-foreground" : "border-transparent text-muted-foreground"}`}>time</button>
          <button onClick={() => setShowName((v) => !v)} className={`text-xs px-2 py-1 rounded border transition-colors ${showName ? "border-border bg-accent text-foreground" : "border-transparent text-muted-foreground"}`}>name</button>
          {entries.length > 0 && (
            <button onClick={clear} className="text-sm text-muted-foreground hover:text-foreground transition-colors ml-2">Clear live</button>
          )}
        </div>
      </div>

      {splitView ? (
        // Split view — one column per agent
        <div className="flex-1 overflow-hidden">
          {agents.length === 0 && !historyLoading && (
            <p className="text-muted-foreground/50 font-mono text-xs">
              No stream history yet. Enable "Stream History" on an agent and run it.
            </p>
          )}
          {historyLoading && agents.length === 0 && (
            <p className="text-muted-foreground/40 font-mono text-xs">Loading history…</p>
          )}
          <div
            className="grid h-full gap-3"
            style={{ gridTemplateColumns: `repeat(${Math.max(agents.length, 1)}, minmax(0, 1fr))` }}
          >
            {agents.map(({ agentId, agentName }) => {
              const color = agentColor(agentId);
              const agentEntries = allEntries.filter((e) => e.agentId === agentId);
              // Show newest at top — entries from context are already newest-first,
              // history entries are oldest-first, so sort descending by ts then id
              const sorted = [...agentEntries].sort((a, b) => b.ts - a.ts || b.id - a.id);

              return (
                <div key={agentId} className="flex flex-col min-h-0 bg-muted/40 rounded-lg border border-border overflow-hidden">
                  {/* Column header */}
                  <div className={`flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/60 shrink-0`}>
                    <span className={`text-xs font-semibold ${color}`}>{agentName}</span>
                    <span className="text-xs text-muted-foreground/50 ml-auto">{agentEntries.length} entries</span>
                  </div>
                  {/* Column logs */}
                  <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-xs">
                    {sorted.length === 0 ? (
                      <p className="text-muted-foreground/40">No entries</p>
                    ) : (
                      sorted.map((entry) => (
                        <LogLine key={entry.id} entry={entry} showTime={showTime} showName={false} />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        // Combined view (original)
        <div className="flex-1 overflow-y-auto bg-muted/40 rounded-lg border border-border px-4 py-3 font-mono text-xs">
          {entries.length === 0 && history.length === 0 && !historyLoading && (
            <p className="text-muted-foreground/50">
              No stream history yet. Enable "Stream History" on an agent and run it.
            </p>
          )}

          {entries.map((entry) => <LogLine key={entry.id} entry={entry} showTime={showTime} showName={showName} />)}

          {entries.length > 0 && history.length > 0 && (
            <div className="flex items-center gap-2 my-2 text-muted-foreground/40">
              <div className="flex-1 border-t border-border" />
              <span className="text-xs">older</span>
              <div className="flex-1 border-t border-border" />
            </div>
          )}

          {historyLoading ? (
            <p className="text-muted-foreground/40 text-xs py-1">Loading history…</p>
          ) : (
            history.map((entry) => <LogLine key={entry.id} entry={entry} showTime={showTime} showName={showName} />)
          )}
        </div>
      )}
    </div>
  );
}
