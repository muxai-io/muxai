"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { TEAM_BLUEPRINTS, getTemplate, type TeamBlueprint } from "@/lib/team-blueprints";
import { Rocket, Crown, Loader2, User, Check, Shield, Cpu, Zap, Radio } from "lucide-react";

interface MemberConfig {
  templateId: string;
  blueprintRole: "lead" | "reporter";
  name: string;
  defaultPrompt: string;
  skillMd: string;
}

interface DeployStep {
  label: string;
  sublabel: string;
  icon: React.ReactNode;
}

function DeployOverlay({
  steps,
  currentStep,
  progress,
  done,
}: {
  steps: DeployStep[];
  currentStep: number;
  progress: number;
  done: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-md space-y-6 rounded-xl border bg-card p-8 shadow-2xl">
        {/* Header */}
        <div className="text-center space-y-1">
          <div className="flex justify-center mb-3">
            <div className={cn(
              "flex h-12 w-12 items-center justify-center rounded-full",
              done ? "bg-green-500/10" : "bg-primary/10"
            )}>
              {done ? (
                <Check className="h-6 w-6 text-green-500" />
              ) : (
                <Rocket className="h-6 w-6 text-primary animate-pulse" />
              )}
            </div>
          </div>
          <h2 className="text-lg font-semibold">
            {done ? "Team Deployed" : "Deploying Team"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {done ? "All agents are online" : "Initializing agents..."}
          </p>
        </div>

        {/* Progress bar */}
        <div className="space-y-2">
          <Progress value={progress} className="h-2.5" />
          <p className="text-xs text-muted-foreground text-right font-mono">
            {Math.round(progress)}%
          </p>
        </div>

        {/* Step list */}
        <div className="space-y-1">
          {steps.map((step, i) => {
            const isActive = i === currentStep && !done;
            const isComplete = i < currentStep || done;
            return (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-300",
                  isActive && "bg-primary/5 scale-[1.02]",
                  isComplete && "opacity-70",
                  !isActive && !isComplete && "opacity-30"
                )}
              >
                {/* Status indicator */}
                <div className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all duration-300",
                  isComplete && "bg-green-500/10",
                  isActive && "bg-primary/10",
                  !isActive && !isComplete && "bg-muted"
                )}>
                  {isComplete ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : isActive ? (
                    <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
                  ) : (
                    <span className="h-3.5 w-3.5">{step.icon}</span>
                  )}
                </div>

                {/* Label */}
                <div className="min-w-0 flex-1">
                  <p className={cn(
                    "text-sm font-medium truncate",
                    isActive && "text-foreground",
                    isComplete && "text-muted-foreground",
                    !isActive && !isComplete && "text-muted-foreground"
                  )}>
                    {step.label}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {isActive ? step.sublabel : isComplete ? "Ready" : "Pending"}
                  </p>
                </div>

                {/* Elapsed dot for active */}
                {isActive && (
                  <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
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
      disallowedTools: tpl.form.disallowedTools || undefined,
      ...(tpl.resultCard ? { resultCard: tpl.resultCard } : {}),
    },
    runtimeConfig: {},
  };
}

const STEP_ICONS: Record<string, React.ReactNode> = {
  "team-lead": <Crown className="h-3.5 w-3.5" />,
  "news-analyst": <Radio className="h-3.5 w-3.5" />,
  "technical-analyst": <Cpu className="h-3.5 w-3.5" />,
  "data-analyst": <Zap className="h-3.5 w-3.5" />,
};

const STEP_SUBLABELS: Record<string, string> = {
  "team-lead": "Configuring orchestration...",
  "news-analyst": "Connecting news feeds...",
  "technical-analyst": "Loading chart analysis...",
  "data-analyst": "Initializing data pipeline...",
};

export default function DeployTeamPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mcpRootPath, setMcpRootPath] = useState("");
  const [selectedBlueprint, setSelectedBlueprint] = useState<TeamBlueprint | null>(null);
  const [members, setMembers] = useState<MemberConfig[]>([]);

  // Deploy animation state
  const [deploying, setDeploying] = useState(false);
  const [deploySteps, setDeploySteps] = useState<DeployStep[]>([]);
  const [deployCurrentStep, setDeployCurrentStep] = useState(0);
  const [deployProgress, setDeployProgress] = useState(0);
  const [deployDone, setDeployDone] = useState(false);
  const redirectIdRef = useRef<string | null>(null);

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
        defaultPrompt: tpl?.defaultPrompt ?? "",
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

    // Build the animation steps: init → each agent → finalize
    const steps: DeployStep[] = [
      {
        label: "Preparing environment",
        sublabel: "Setting up workspace...",
        icon: <Shield className="h-3.5 w-3.5" />,
      },
      ...members.map((m) => ({
        label: m.name,
        sublabel: STEP_SUBLABELS[m.templateId] ?? "Initializing agent...",
        icon: STEP_ICONS[m.templateId] ?? <User className="h-3.5 w-3.5" />,
      })),
      {
        label: "Generating wallets",
        sublabel: "Creating Solana & EVM keypairs...",
        icon: <Zap className="h-3.5 w-3.5" />,
      },
      {
        label: "Wiring team hierarchy",
        sublabel: "Linking reporters to lead...",
        icon: <Rocket className="h-3.5 w-3.5" />,
      },
    ];

    setDeploySteps(steps);
    setDeployCurrentStep(0);
    setDeployProgress(0);
    setDeployDone(false);
    setDeploying(true);

    // Fire the actual API call immediately
    const deployPromise = apiFetch<{ id: string }>("/api/teams/deploy", {
      method: "POST",
      body: JSON.stringify({
        lead: buildAgentPayload(leadMember, mcpRootPath),
        reporters: reporterMembers.map((m) => buildAgentPayload(m, mcpRootPath)),
      }),
    });

    // Animate through the steps ~1s each
    const stepDuration = 1000;
    for (let i = 0; i < steps.length; i++) {
      setDeployCurrentStep(i);
      // Smooth progress fill within each step
      const stepStart = (i / steps.length) * 100;
      const stepEnd = ((i + 1) / steps.length) * 100;
      setDeployProgress(stepStart);
      // Animate to ~80% of step range quickly, then hold
      await new Promise((r) => setTimeout(r, 150));
      setDeployProgress(stepStart + (stepEnd - stepStart) * 0.8);
      await new Promise((r) => setTimeout(r, stepDuration - 150));
    }

    // Wait for the real API response
    try {
      const result = await deployPromise;
      redirectIdRef.current = result.id;
    } catch (err) {
      setDeploying(false);
      setLoading(false);
      setError(err instanceof Error ? err.message : "Failed to deploy team");
      return;
    }

    // Show completion
    setDeployProgress(100);
    setDeployDone(true);
    await new Promise((r) => setTimeout(r, 1200));

    // Redirect
    setDeploying(false);
    setLoading(false);
    if (redirectIdRef.current) {
      router.push(`/agents/${redirectIdRef.current}`);
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TEAM_BLUEPRINTS.map((bp) => {
            const isSelected = selectedBlueprint?.id === bp.id;
            const leadTpl = getTemplate(bp.members.find((m) => m.role === "lead")?.templateId ?? "");
            const reporterTpls = bp.members
              .filter((m) => m.role === "reporter")
              .map((m) => getTemplate(m.templateId))
              .filter(Boolean);
            return (
              <button
                key={bp.id}
                onClick={() => selectBlueprint(bp)}
                className={cn(
                  "group relative overflow-hidden rounded-xl border text-left transition-all duration-200 h-56",
                  isSelected
                    ? "border-primary ring-1 ring-primary/30"
                    : "border-border hover:border-primary/50"
                )}
              >
                {/* Background image */}
                {bp.image && (
                  <>
                    <img
                      src={bp.image}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-black/70 group-hover:bg-black/65 transition-colors duration-300" />
                  </>
                )}

                {/* Content overlay */}
                <div className="relative z-10 flex h-full flex-col justify-between p-5">
                  {/* Top — title, description, count */}
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-bold text-white">{bp.label}</p>
                        <p className="text-xs text-white/60 mt-1 leading-relaxed">{bp.description}</p>
                      </div>
                      <span className="shrink-0 inline-flex items-center rounded-full bg-white/10 backdrop-blur-sm px-2 py-0.5 text-xs text-white/70">
                        {bp.members.length}
                      </span>
                    </div>
                  </div>

                  {/* Bottom — agent roster */}
                  <div className="flex flex-wrap gap-2">
                    {leadTpl && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 backdrop-blur-sm px-2.5 py-1 text-xs text-white/90">
                        <Crown className="h-3 w-3 text-primary" />
                        {leadTpl.label}
                      </span>
                    )}
                    {reporterTpls.map((tpl) => (
                      <span key={tpl!.id} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 backdrop-blur-sm px-2.5 py-1 text-xs text-white/70">
                        <User className="h-3 w-3" />
                        {tpl!.label}
                      </span>
                    ))}
                  </div>
                </div>
              </button>
            );
          })}
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

      {/* Deploy Animation Overlay */}
      {deploying && (
        <DeployOverlay
          steps={deploySteps}
          currentStep={deployCurrentStep}
          progress={deployProgress}
          done={deployDone}
        />
      )}
    </div>
  );
}
