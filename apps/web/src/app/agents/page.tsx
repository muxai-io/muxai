import Link from "next/link";
import { Bot, PlusCircle, CalendarClock, AlertTriangle } from "lucide-react";
import { apiFetch } from "@/lib/utils";
import type { Agent } from "@/lib/types";
import { AgentStatusBadge } from "@/components/agent-status-badge";
import { Button } from "@/components/ui/button";
import { InvokeButton } from "./[id]/invoke-button";

async function getAgents(): Promise<Agent[]> {
  try { return await apiFetch<Agent[]>("/api/agents"); } catch { return []; }
}

function shortModel(model: string): string {
  if (model.includes("opus")) return "Opus";
  if (model.includes("sonnet")) return "Sonnet";
  if (model.includes("haiku")) return "Haiku";
  return model.split("-")[1] ?? model;
}

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

function AgentCard({ agent }: { agent: Agent }) {
  const config = agent.adapterConfig as Record<string, unknown>;
  const rt = agent.runtimeConfig as Record<string, unknown>;
  const hb = rt?.heartbeat as { enabled?: boolean; cron?: string } | undefined;
  const model = shortModel((config.model as string) ?? "");
  const runCount = agent._count?.runs ?? 0;

  return (
    <div className="rounded-xl border border-border bg-card hover:bg-accent/20 transition-colors group">
      <Link href={`/agents/${agent.id}`} className="block p-4">
        <div className="flex items-start gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-sm font-bold uppercase ${roleColor(agent.role)}`}>
            {agent.name.slice(0, 2)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold leading-none truncate">{agent.name}</p>
              <AgentStatusBadge status={agent.status} />
            </div>
            <p className="text-xs text-muted-foreground mt-1 capitalize">{agent.title || agent.role}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-3 flex-wrap">
          {model && (
            <span className="text-xs px-1.5 py-0.5 rounded border border-border text-muted-foreground font-mono">{model}</span>
          )}
          {hb?.enabled && (
            <span className="flex items-center gap-1 text-xs text-violet-400">
              <CalendarClock className="h-3 w-3" />
              Scheduled
            </span>
          )}
          <span className="text-xs text-muted-foreground ml-auto">{runCount} run{runCount !== 1 ? "s" : ""}</span>
        </div>
      </Link>

      <div className="border-t border-border px-4 py-2.5 flex items-center gap-2">
        {agent.status !== "terminated" && <InvokeButton agentId={agent.id} size="sm" />}
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground text-xs h-7">
          <Link href={`/agents/${agent.id}/edit`}>Edit</Link>
        </Button>
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground text-xs h-7">
          <Link href={`/agents/${agent.id}/runs`}>Runs</Link>
        </Button>
        {agent.status === "running" && (
          <Button asChild variant="ghost" size="sm" className="text-blue-400 text-xs h-7 ml-auto">
            <Link href={`/agents/${agent.id}/runs`}>
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
              Live
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

export default async function AgentsPage() {
  const agents = await getAgents();

  const active = agents.filter((a) => a.status !== "terminated");
  const errored = agents.filter((a) => a.status === "error");

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-none">Agents</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {active.length} active · {agents.length} total
              {errored.length > 0 && (
                <span className="ml-2 text-red-400 inline-flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />{errored.length} error{errored.length > 1 ? "s" : ""}
                </span>
              )}
            </p>
          </div>
        </div>
        <Button asChild size="sm">
          <Link href="/agents/new">
            <PlusCircle className="h-4 w-4" />
            New Agent
          </Link>
        </Button>
      </div>

      {agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-24 text-center">
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
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((a) => <AgentCard key={a.id} agent={a} />)}
        </div>
      )}
    </div>
  );
}
