import Link from "next/link";
import { UsersRound, Rocket } from "lucide-react";
import { apiFetch } from "@/lib/utils";
import type { Agent } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { TeamList } from "./team-list";

async function getAgents(): Promise<Agent[]> {
  try { return await apiFetch<Agent[]>("/api/agents"); } catch { return []; }
}

export default async function TeamsPage() {
  const agents = await getAgents();
  const leads = agents.filter((a) => (a.reports ?? []).length > 0 && a.status !== "terminated");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <UsersRound className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-none">Teams</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {leads.length} team{leads.length !== 1 ? "s" : ""} deployed
            </p>
          </div>
        </div>
        <Button asChild size="sm">
          <Link href="/teams/deploy">
            <Rocket className="h-4 w-4" />
            Deploy Team
          </Link>
        </Button>
      </div>

      {leads.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-24 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
            <UsersRound className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">No teams yet</p>
          <p className="text-xs text-muted-foreground mt-1 mb-4">Deploy your first team to get started</p>
          <Button asChild variant="outline" size="sm">
            <Link href="/teams/deploy">
              <Rocket className="h-4 w-4" />
              Deploy Team
            </Link>
          </Button>
        </div>
      ) : (
        <TeamList agents={agents} />
      )}
    </div>
  );
}
