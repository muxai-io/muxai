"use client";
import { useState } from "react";
import Link from "next/link";
import { Crown, User, GitBranch, LayoutList, ChevronRight } from "lucide-react";
import type { Agent } from "@/lib/types";
import { AgentStatusBadge } from "@/components/agent-status-badge";
import { cn } from "@/lib/utils";

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

function shortModel(model: string): string {
  if (model.includes("opus")) return "Opus";
  if (model.includes("sonnet")) return "Sonnet";
  if (model.includes("haiku")) return "Haiku";
  return model.split("-")[1] ?? model;
}

// Count all descendants in a tree
function countDescendants(agent: Agent, agentMap: Map<string, Agent>): number {
  const reports = (agent.reports ?? []);
  let count = reports.length;
  for (const r of reports) {
    const full = agentMap.get(r.id);
    if (full) count += countDescendants(full, agentMap);
  }
  return count;
}

// ─── Flat view (existing) ────────────────────────────────────────────────────

function FlatTeamCard({ lead, members }: { lead: Agent; members: Agent[] }) {
  const config = lead.adapterConfig as Record<string, unknown>;
  const model = shortModel((config.model as string) ?? "");

  return (
    <Link href={`/agents/${lead.id}`} className="block group">
      <div className="rounded-xl border border-border bg-card hover:bg-accent/20 transition-colors p-5">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-sm font-bold uppercase ${roleColor(lead.role)}`}>
            {lead.name.slice(0, 2)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Crown className="h-3.5 w-3.5 text-primary" />
              <p className="text-sm font-semibold truncate">{lead.name}</p>
              <AgentStatusBadge status={lead.status} />
              {model && (
                <span className="text-xs px-1.5 py-0.5 rounded border border-border text-muted-foreground font-mono">{model}</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{lead.title || lead.role}</p>
          </div>
          <span className="text-xs text-muted-foreground">{1 + members.length} agents</span>
        </div>

        {members.length > 0 && (
          <div className="flex items-center gap-2 mt-4 flex-wrap">
            {members.map((m) => {
              const mConfig = m.adapterConfig as Record<string, unknown>;
              const mModel = shortModel((mConfig.model as string) ?? "");
              return (
                <div key={m.id} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${roleColor(m.role)}`}>
                  <User className="h-3 w-3" />
                  <span className="text-xs font-medium">{m.name}</span>
                  <AgentStatusBadge status={m.status} />
                  {mModel && <span className="text-xs font-mono opacity-60">{mModel}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Link>
  );
}

// ─── Hierarchy view ──────────────────────────────────────────────────────────

function HierarchyNode({ agent, agentMap, depth }: { agent: Agent; agentMap: Map<string, Agent>; depth: number }) {
  const config = agent.adapterConfig as Record<string, unknown>;
  const model = shortModel((config.model as string) ?? "");
  const reports = (agent.reports ?? []);
  const hasReports = reports.length > 0;
  const isRoot = depth === 0;

  return (
    <div>
      <Link href={`/agents/${agent.id}`} className="block group">
        <div
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent/30",
            isRoot && "bg-card border border-border px-4 py-3"
          )}
        >
          {/* Tree indent lines */}
          {depth > 0 && (
            <div className="flex items-center gap-0" style={{ marginLeft: `${(depth - 1) * 20}px` }}>
              <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
            </div>
          )}

          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-bold uppercase ${roleColor(agent.role)}`}>
            {agent.name.slice(0, 2)}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {isRoot && <Crown className="h-3.5 w-3.5 text-primary" />}
              <p className={cn("text-sm truncate", isRoot ? "font-semibold" : "font-medium")}>{agent.name}</p>
              <AgentStatusBadge status={agent.status} />
              {model && (
                <span className="text-xs px-1.5 py-0.5 rounded border border-border text-muted-foreground font-mono">{model}</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{agent.title || agent.role}</p>
          </div>

          {hasReports && (
            <span className="text-xs text-muted-foreground">{reports.length} report{reports.length !== 1 ? "s" : ""}</span>
          )}
        </div>
      </Link>

      {/* Render children recursively */}
      {reports.map((r) => {
        const full = agentMap.get(r.id);
        if (!full) return null;
        return <HierarchyNode key={r.id} agent={full} agentMap={agentMap} depth={depth + 1} />;
      })}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function TeamList({ agents }: { agents: Agent[] }) {
  const [view, setView] = useState<"flat" | "hierarchy">("hierarchy");

  const agentMap = new Map(agents.map((a) => [a.id, a]));
  const leads = agents.filter((a) => (a.reports ?? []).length > 0 && a.status !== "terminated");

  // For hierarchy: find root agents (have reports but no reportsToId)
  const roots = agents.filter(
    (a) => (a.reports ?? []).length > 0 && !a.reportsToId && a.status !== "terminated"
  );

  return (
    <div className="space-y-4">
      {/* View toggle */}
      <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-1 w-fit">
        <button
          onClick={() => setView("flat")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            view === "flat"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <LayoutList className="h-3.5 w-3.5" />
          Flat
        </button>
        <button
          onClick={() => setView("hierarchy")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            view === "hierarchy"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <GitBranch className="h-3.5 w-3.5" />
          Hierarchy
        </button>
      </div>

      {/* Flat view */}
      {view === "flat" && (
        <div className="space-y-6">
          {leads.map((lead) => {
            const members = (lead.reports ?? [])
              .map((r) => agents.find((a) => a.id === r.id))
              .filter(Boolean) as Agent[];
            return <FlatTeamCard key={lead.id} lead={lead} members={members} />;
          })}
        </div>
      )}

      {/* Hierarchy view */}
      {view === "hierarchy" && (
        <div className="space-y-4">
          {roots.map((root) => {
            const total = 1 + countDescendants(root, agentMap);
            return (
              <div key={root.id} className="rounded-xl border border-border bg-card/50 p-4 space-y-1">
                <div className="flex items-center gap-2 mb-2">
                  <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                    {root.name} Organization
                  </span>
                  <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{total}</span>
                </div>
                <HierarchyNode agent={root} agentMap={agentMap} depth={0} />
              </div>
            );
          })}
          {roots.length === 0 && leads.length > 0 && (
            <p className="text-sm text-muted-foreground">
              No root-level teams found. All leads report to another agent.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
