"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TEAM_BLUEPRINTS, getTemplate, type TeamBlueprint } from "@/lib/team-blueprints";
import { Rocket, Crown, Loader2, User } from "lucide-react";

interface MemberConfig {
  templateId: string;
  blueprintRole: "lead" | "reporter";
  name: string;
  defaultPrompt: string;
  skillMd: string;
}

function buildAgentPayload(
  member: MemberConfig,
  mcpRootPath: string
) {
  const tpl = getTemplate(member.templateId);
  if (!tpl) throw new Error(`Unknown template: ${member.templateId}`);

  return {
    name: member.name,
    role: tpl.form.role,
    title: tpl.form.title || undefined,
    capabilities: tpl.form.capabilities || undefined,
    adapterConfig: {
      model: tpl.form.model,
      cwd: tpl.mcpPreset === "builtin" ? mcpRootPath : undefined,
      promptTemplate: member.skillMd || undefined,
      defaultPrompt: member.defaultPrompt || undefined,
      maxTurnsPerRun: Number(tpl.form.maxTurnsPerRun),
      useChrome: tpl.useChrome || undefined,
      persistLogs: tpl.persistLogs ?? true,
      ...(tpl.resultCard ? { resultCard: tpl.resultCard } : {}),
    },
    runtimeConfig: {},
  };
}

export default function DeployTeamPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mcpRootPath, setMcpRootPath] = useState("");
  const [selectedBlueprint, setSelectedBlueprint] = useState<TeamBlueprint | null>(null);
  const [members, setMembers] = useState<MemberConfig[]>([]);

  // Fetch MCP root path on mount
  useEffect(() => {
    apiFetch<{ rootPath: string }>("/api/mcp-servers")
      .then(({ rootPath }) => setMcpRootPath(rootPath))
      .catch(() => {});
  }, []);

  async function selectBlueprint(bp: TeamBlueprint) {
    setSelectedBlueprint(bp);
    setError(null);

    // Load SKILL.md for each unique template in parallel
    const templateIds = [...new Set(bp.members.map((m) => m.templateId))];
    const skills: Record<string, string> = {};
    await Promise.all(
      templateIds.map(async (id) => {
        try {
          const res = await fetch(`/api/templates/${id}`);
          if (res.ok) {
            const { content } = await res.json();
            skills[id] = content;
          }
        } catch {
          // SKILL.md is optional
        }
      })
    );

    // Build initial member configs from templates
    const configs: MemberConfig[] = bp.members.map((m) => {
      const tpl = getTemplate(m.templateId);
      return {
        templateId: m.templateId,
        blueprintRole: m.role,
        name: tpl?.form.name ?? m.templateId,
        defaultPrompt: "",
        skillMd: skills[m.templateId] ?? "",
      };
    });
    setMembers(configs);
  }

  function updateMember(index: number, field: "name" | "defaultPrompt", value: string) {
    setMembers((prev) => prev.map((m, i) => (i === index ? { ...m, [field]: value } : m)));
  }

  async function handleDeploy() {
    if (!selectedBlueprint || members.length === 0) return;

    setLoading(true);
    setError(null);

    const leadMember = members.find((m) => m.blueprintRole === "lead");
    const reporterMembers = members.filter((m) => m.blueprintRole === "reporter");

    if (!leadMember) {
      setError("Blueprint has no lead agent");
      setLoading(false);
      return;
    }

    try {
      const result = await apiFetch<{ id: string }>("/api/teams/deploy", {
        method: "POST",
        body: JSON.stringify({
          lead: buildAgentPayload(leadMember, mcpRootPath),
          reporters: reporterMembers.map((m) => buildAgentPayload(m, mcpRootPath)),
        }),
      });
      router.push(`/agents/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deploy team");
    } finally {
      setLoading(false);
    }
  }

  const leadMember = members.find((m) => m.blueprintRole === "lead");
  const reporterMembers = members.filter((m) => m.blueprintRole === "reporter");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Rocket className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Deploy Team</h1>
          <p className="text-sm text-muted-foreground">
            Spin up a full agent team from a blueprint
          </p>
        </div>
      </div>

      {/* Blueprint Picker */}
      <div className="space-y-3">
        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Blueprint</Label>
        <div className="flex gap-2">
          {TEAM_BLUEPRINTS.map((bp) => (
            <button
              key={bp.id}
              onClick={() => selectBlueprint(bp)}
              className={cn(
                "rounded-lg border px-4 py-3 text-left transition-colors",
                selectedBlueprint?.id === bp.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-card-foreground hover:border-primary/50"
              )}
            >
              <p className="text-sm font-medium">{bp.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{bp.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Team Configuration */}
      {selectedBlueprint && members.length > 0 && (
        <div className="space-y-4">
          {/* Lead Card */}
          {leadMember && (
            <Card className="border-primary/30">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Crown className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base">Lead Agent</CardTitle>
                  <span className="ml-auto text-xs font-mono text-muted-foreground">
                    {getTemplate(leadMember.templateId)?.form.model}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {getTemplate(leadMember.templateId)?.form.maxTurnsPerRun} turns
                  </span>
                </div>
                <CardDescription>{getTemplate(leadMember.templateId)?.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Name</Label>
                  <Input
                    value={leadMember.name}
                    onChange={(e) => updateMember(members.indexOf(leadMember), "name", e.target.value)}
                    placeholder="Team Lead"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Default Prompt</Label>
                  <Textarea
                    value={leadMember.defaultPrompt}
                    onChange={(e) => updateMember(members.indexOf(leadMember), "defaultPrompt", e.target.value)}
                    placeholder="Task for the lead agent on each run..."
                    rows={3}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Reporter Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {reporterMembers.map((member) => {
              const tpl = getTemplate(member.templateId);
              const idx = members.indexOf(member);
              return (
                <Card key={idx}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-sm">{tpl?.label ?? member.templateId}</CardTitle>
                      <span className="ml-auto text-xs font-mono text-muted-foreground">
                        {tpl?.form.model}
                      </span>
                    </div>
                    <CardDescription className="text-xs">{tpl?.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Name</Label>
                      <Input
                        value={member.name}
                        onChange={(e) => updateMember(idx, "name", e.target.value)}
                        placeholder={tpl?.form.name}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Default Prompt</Label>
                      <Textarea
                        value={member.defaultPrompt}
                        onChange={(e) => updateMember(idx, "defaultPrompt", e.target.value)}
                        placeholder="Task for this reporter..."
                        rows={3}
                      />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Deploy Button */}
          <div className="flex items-center gap-3">
            <Button onClick={handleDeploy} disabled={loading} className="gap-2">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deploying...
                </>
              ) : (
                <>
                  <Rocket className="h-4 w-4" />
                  Deploy Team
                </>
              )}
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
