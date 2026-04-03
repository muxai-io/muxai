import Link from "next/link";
import { PlusCircle, Bot, Activity, Clock, Zap, AlertTriangle, CalendarClock, Play, ChevronRight } from "lucide-react";
import { apiFetch } from "@/lib/utils";
import type { Agent, HeartbeatRun } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { AgentStatusBadge } from "@/components/agent-status-badge";
import { RunStatusBadge } from "@/components/run-status-badge";
import { RunResult } from "@/components/run-result";
import type { ResultCardConfig } from "@/lib/result-cards";

async function getAgents(): Promise<Agent[]> {
  try { return await apiFetch<Agent[]>("/api/agents"); } catch { return []; }
}
async function getRecentRuns(): Promise<HeartbeatRun[]> {
  try { return await apiFetch<HeartbeatRun[]>("/api/runs?limit=15"); } catch { return []; }
}
async function getLatestResult(): Promise<HeartbeatRun | null> {
  try {
    const runs = await apiFetch<HeartbeatRun[]>("/api/runs?withResults=true&limit=1");
    return runs[0] ?? null;
  } catch { return null; }
}

function shortModel(model: string): string {
  if (model.includes("opus")) return "Opus";
  if (model.includes("sonnet")) return "Sonnet";
  if (model.includes("haiku")) return "Haiku";
  return model.split("-")[1] ?? model;
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

function duration(run: HeartbeatRun): string | null {
  if (!run.startedAt || !run.finishedAt) return null;
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function formatDate(): string {
  return new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

// ─── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, icon: Icon, color, pulse,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color: string; pulse?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-widest">{label}</span>
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div>
        <div className="flex items-end gap-2">
          <span className="text-3xl font-bold tracking-tight">{value}</span>
          {pulse && Number(value) > 0 && (
            <span className="mb-1 h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          )}
        </div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Agent Row ─────────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  "ceo": "bg-violet-500/15 text-violet-400 border-violet-500/20",
  "news-analyst": "bg-blue-500/15 text-blue-400 border-blue-500/20",
  "technical-analyst": "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  "analyst": "bg-indigo-500/15 text-indigo-400 border-indigo-500/20",
  "engineer": "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  "general": "bg-slate-500/15 text-slate-400 border-slate-500/20",
};

function roleColor(role: string): string {
  return ROLE_COLORS[role] ?? "bg-slate-500/15 text-slate-400 border-slate-500/20";
}

function AgentRow({ agent }: { agent: Agent }) {
  const config = agent.adapterConfig as Record<string, unknown>;
  const rt = agent.runtimeConfig as Record<string, unknown>;
  const hb = rt?.heartbeat as { enabled?: boolean; cron?: string } | undefined;
  const model = shortModel((config.model as string) ?? "");

  return (
    <Link href={`/agents/${agent.id}`} className="block group">
      <div className="flex items-center justify-between px-4 py-3 rounded-lg border border-border bg-card hover:bg-accent/40 transition-colors">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-xs font-bold uppercase ${roleColor(agent.role)}`}>
            {agent.name.slice(0, 2)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium leading-none truncate">{agent.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate capitalize">{agent.title || agent.role}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          {model && (
            <span className="hidden sm:inline-flex text-xs px-1.5 py-0.5 rounded border border-border text-muted-foreground font-mono">{model}</span>
          )}
          {hb?.enabled && (
            <span className="hidden md:inline-flex items-center gap-1 text-xs text-violet-400">
              <CalendarClock className="h-3 w-3" />
            </span>
          )}
          <span className="text-xs text-muted-foreground">{agent._count?.runs ?? 0}</span>
          <AgentStatusBadge status={agent.status} />
        </div>
      </div>
    </Link>
  );
}

// ─── Agent List ─────────────────────────────────────────────────────────────────

function AgentList({ agents }: { agents: Agent[] }) {
  const active = agents.filter((a) => a.status !== "terminated");
  const terminated = agents.filter((a) => a.status === "terminated");
  const sorted = [...active, ...terminated];

  return (
    <div className="space-y-1.5">
      {sorted.map((agent) => <AgentRow key={agent.id} agent={agent} />)}
    </div>
  );
}

// ─── Run Timeline ───────────────────────────────────────────────────────────────

const RUN_DOT: Record<string, string> = {
  succeeded: "bg-emerald-500",
  failed: "bg-red-500",
  running: "bg-blue-500 animate-pulse",
  queued: "bg-amber-500",
  cancelled: "bg-slate-500",
  timed_out: "bg-orange-500",
};

function RunRow({ run }: { run: HeartbeatRun }) {
  const dur = duration(run);
  return (
    <Link href={`/agents/${run.agent?.id}/runs/${run.id}`} className="flex items-start gap-3 group py-2.5 px-4 hover:bg-accent/40 transition-colors">
      <div className="flex flex-col items-center pt-1 shrink-0">
        <div className={`h-2 w-2 rounded-full shrink-0 ${RUN_DOT[run.status] ?? "bg-slate-500"}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium truncate">{run.agent?.name ?? "—"}</span>
          <span className="text-xs text-muted-foreground shrink-0">{timeAgo(run.createdAt)}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <RunStatusBadge status={run.status} />
          {dur && <span className="text-xs text-muted-foreground font-mono">{dur}</span>}
          <span className="text-xs text-muted-foreground capitalize opacity-60">{run.invocationSource?.replace("_", " ")}</span>
        </div>
      </div>
    </Link>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const [agents, recentRuns, latestResult] = await Promise.all([getAgents(), getRecentRuns(), getLatestResult()]);

  const active = agents.filter((a) => a.status !== "terminated");
  const running = agents.filter((a) => a.status === "running");
  const errored = agents.filter((a) => a.status === "error");
  const scheduled = agents.filter((a) => {
    const rt = a.runtimeConfig as Record<string, unknown>;
    return (rt?.heartbeat as { enabled?: boolean })?.enabled && a.status !== "terminated";
  });

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const runsToday = recentRuns.filter((r) => new Date(r.createdAt) >= todayStart);
  const failedToday = runsToday.filter((r) => r.status === "failed").length;

  const systemStatus = errored.length > 0
    ? { label: "Degraded", color: "bg-red-500/10 text-red-400 border-red-500/20" }
    : running.length > 0
    ? { label: "Active", color: "bg-blue-500/10 text-blue-400 border-blue-500/20" }
    : { label: "All idle", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" };

  return (
    <div className="space-y-8">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-1">{formatDate()}</p>
          <h1 className="text-2xl font-bold tracking-tight">{greeting()}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{agents.length} agents registered across {agents.filter(a => (a.reports ?? []).length > 0).length} teams</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium ${systemStatus.color}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {systemStatus.label}
          </div>
          <Button asChild size="sm">
            <Link href="/agents/new">
              <PlusCircle className="h-4 w-4" />
              New Agent
            </Link>
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active Agents"
          value={active.length}
          icon={Bot}
          color="bg-blue-500/10 text-blue-400"
          sub={`${agents.length} total · ${errored.length > 0 ? `${errored.length} errors` : "no errors"}`}
        />
        <StatCard
          label="Running Now"
          value={running.length}
          icon={Activity}
          color="bg-emerald-500/10 text-emerald-400"
          sub={running.length > 0 ? running.map((a) => a.name).join(", ") : "Nothing running"}
          pulse
        />
        <StatCard
          label="Scheduled"
          value={scheduled.length}
          icon={Clock}
          color="bg-violet-500/10 text-violet-400"
          sub={scheduled.length > 0 ? scheduled.map((a) => a.name).join(", ") : "No scheduled agents"}
        />
        <StatCard
          label="Runs Today"
          value={runsToday.length}
          icon={Zap}
          color="bg-amber-500/10 text-amber-400"
          sub={failedToday > 0 ? `${failedToday} failed` : "All succeeded"}
        />
      </div>

      {/* Latest result */}
      {latestResult?.resultJson && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-sm">Latest Result</h2>
              <span className="text-xs text-muted-foreground">{latestResult.agent?.name}</span>
              <span className="text-xs text-muted-foreground font-mono opacity-60">{timeAgo(latestResult.createdAt)}</span>
            </div>
            <Link href="/results" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              All results <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <RunResult
            resultJson={latestResult.resultJson}
            cardConfig={(latestResult.agent?.adapterConfig?.resultCard as ResultCardConfig | undefined)}
            compact
          />
        </div>
      )}

      {/* Main content */}
      <div className="grid gap-6 lg:grid-cols-5">

        {/* Agents — 3 cols */}
        <div className="lg:col-span-3 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-sm">Agents</h2>
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-md">{active.length}</span>
            </div>
            {errored.length > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-red-400 bg-red-500/10 px-2 py-1 rounded-full border border-red-500/20">
                <AlertTriangle className="h-3 w-3" />
                {errored.length} error{errored.length > 1 ? "s" : ""}
              </span>
            )}
          </div>

          {agents.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
                <Bot className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No agents yet</p>
              <p className="text-xs text-muted-foreground mt-1 mb-4">Create your first agent to get started</p>
              <Button asChild variant="outline" size="sm">
                <Link href="/agents/new">
                  <PlusCircle className="h-4 w-4" />
                  Create Agent
                </Link>
              </Button>
            </div>
          ) : (
            <AgentList agents={agents} />
          )}
        </div>

        {/* Recent runs — 2 cols */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-sm">Recent Activity</h2>
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-md">{recentRuns.length}</span>
            </div>
          </div>

          {recentRuns.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
                <Play className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No runs yet</p>
              <p className="text-xs text-muted-foreground mt-1">Runs appear here once agents are invoked</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
              {recentRuns.map((run) => <RunRow key={run.id} run={run} />)}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
