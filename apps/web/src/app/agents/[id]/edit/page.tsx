"use client";
import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { apiFetch } from "@/lib/utils";
import { useLogStream } from "@/components/log-stream-context";
import type { Agent } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MODELS, DEFAULT_MODEL } from "@/lib/models";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Settings2, Lock } from "lucide-react";

interface McpTool { name: string; fullName: string; description: string; }
interface McpServer { id: string; label: string; description: string; command: string; args: string[]; tools: McpTool[]; }
interface McpRegistryResponse { rootPath: string; servers: McpServer[]; }

interface AgentRole { id: string; name: string; description?: string | null; }

const SCHEDULE_PRESETS = [
  { label: "Disabled", value: "disabled" },
  { label: "Every 15 minutes", value: "*/15 * * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every 4 hours", value: "0 */4 * * *" },
  { label: "Every 8 hours", value: "0 */8 * * *" },
  { label: "Every day (midnight)", value: "0 0 * * *" },
  { label: "Custom cron", value: "custom" },
];

function StepHeader({ step, title, description }: { step: number; title: string; description?: string }) {
  return (
    <div className="flex items-start gap-3 p-6 pb-0">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold mt-0.5">
        {step}
      </div>
      <div>
        <p className="font-semibold text-sm leading-none">{title}</p>
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </div>
    </div>
  );
}

function resolveSchedulePreset(cron: string | undefined): string {
  if (!cron) return "disabled";
  const match = SCHEDULE_PRESETS.find((p) => p.value === cron && p.value !== "disabled" && p.value !== "custom");
  return match ? match.value : "custom";
}

function resolveMcpPreset(cwd: string | undefined, rootPath: string): string {
  if (cwd && rootPath && cwd !== rootPath) return "global";
  return "builtin";
}

export default function EditAgentPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { clearAgent } = useLogStream();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [schedulePreset, setSchedulePreset] = useState("disabled");
  const [mcpPreset, setMcpPreset] = useState("builtin");
  const [builtInServers, setBuiltInServers] = useState<McpServer[]>([]);
  const [mcpRootPath, setMcpRootPath] = useState("");
  const [agents, setAgents] = useState<{ id: string; name: string; role: string }[]>([]);
  const [roles, setRoles] = useState<AgentRole[]>([]);
  const [reportsToId, setReportsToId] = useState<string>("none");
  const [useChrome, setUseChrome] = useState(false);
  const [persistLogs, setPersistLogs] = useState(false);
  const [reviewDecisions, setReviewDecisions] = useState(false);
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [disabledMcpTools, setDisabledMcpTools] = useState<Set<string>>(new Set());
  const [isControlTower, setIsControlTower] = useState(false);

  const [form, setForm] = useState({
    name: "",
    role: "general",
    title: "",
    capabilities: "",
    model: DEFAULT_MODEL as string,
    effort: "none",
    cwd: "",
    disallowedTools: "Read,Write,Edit,Bash,Grep,Glob,Agent",
    promptTemplate: "",
    defaultPrompt: "",
    maxTurnsPerRun: "10",
    customCron: "",
  });

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function splitDisallowed(raw: string): { system: string; mcp: Set<string> } {
    const all = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const mcp = new Set(all.filter((t) => t.startsWith("mcp__")));
    const system = all.filter((t) => !t.startsWith("mcp__")).join(",");
    return { system, mcp };
  }

  function mergeDisallowed(system: string, mcp: Set<string>): string {
    const parts = system.split(",").map((s) => s.trim()).filter(Boolean);
    return [...parts, ...mcp].join(",");
  }

  function handleMcpPreset(value: string) {
    setMcpPreset(value);
    if (value === "builtin") {
      set("disallowedTools", "Read,Write,Edit,Bash,Grep,Glob,Agent");
      setDisabledMcpTools(new Set());
      set("cwd", mcpRootPath);
    } else {
      set("disallowedTools", "Read,Write,Edit,Bash,Grep,Glob,Agent");
      setDisabledMcpTools(new Set());
      set("cwd", "");
    }
  }

  function handleSchedulePreset(value: string) {
    setSchedulePreset(value);
    if (value !== "custom" && value !== "disabled") set("customCron", value);
    else if (value === "disabled") set("customCron", "");
  }

  useEffect(() => {
    apiFetch<McpRegistryResponse>("/api/mcp-servers")
      .then(({ rootPath, servers }) => { setMcpRootPath(rootPath); setBuiltInServers(servers); })
      .catch(() => {});
    apiFetch<{ id: string; name: string; role: string }[]>("/api/agents")
      .then((all) => setAgents(all.filter((a) => a.id !== id)))
      .catch(() => {});
    apiFetch<AgentRole[]>("/api/roles")
      .then(setRoles)
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    if (builtInServers.length === 0) return;
    setLoading(true);
    apiFetch<Agent>(`/api/agents/${id}`)
      .then((agent) => {
        const config = agent.adapterConfig as Record<string, unknown>;
        const runtime = agent.runtimeConfig as Record<string, unknown>;
        const heartbeat = (runtime?.heartbeat ?? {}) as { enabled?: boolean; cron?: string };
        const existingCron = heartbeat.enabled ? heartbeat.cron : undefined;
        const existingTools = config.disallowedTools as string | undefined;
        const raw = existingTools !== undefined ? existingTools : "Read,Write,Edit,Bash,Grep,Glob,Agent";
        const { system, mcp } = splitDisallowed(raw);
        setDisabledMcpTools(mcp);

        setSchedulePreset(resolveSchedulePreset(existingCron));
        setMcpPreset(resolveMcpPreset(config.cwd as string | undefined, mcpRootPath));
        setReportsToId(agent.reportsToId ?? "none");
        setIsControlTower(agent.role === "control_tower");
        setUseChrome(Boolean(config.useChrome));
        setPersistLogs(Boolean(config.persistLogs));
        setReviewDecisions(Boolean(config.reviewDecisions));
        setMemoryEnabled(Boolean(config.memoryEnabled));
        setForm({
          name: agent.name,
          role: agent.role,
          title: agent.title ?? "",
          capabilities: agent.capabilities ?? "",
          model: (config.model as string) ?? DEFAULT_MODEL,
          effort: (config.effort as string) ?? "none",
          cwd: (config.cwd as string) ?? "",
          disallowedTools: system,
          promptTemplate: (config.promptTemplate as string) ?? "",
          defaultPrompt: (config.defaultPrompt as string) ?? "",
          maxTurnsPerRun: String((config.maxTurnsPerRun as number) ?? 10),
          customCron: resolveSchedulePreset(existingCron) === "custom" ? (existingCron ?? "") : "",
        });
      })
      .catch(() => setError("Failed to load agent"))
      .finally(() => setLoading(false));
  }, [id, builtInServers]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const cronValue = schedulePreset === "disabled"
      ? undefined
      : schedulePreset === "custom"
        ? form.customCron
        : schedulePreset;

    try {
      await apiFetch(`/api/agents/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.name,
          role: form.role,
          title: form.title || undefined,
          capabilities: form.capabilities || undefined,
          reportsToId: (reportsToId && reportsToId !== "none") ? reportsToId : undefined,
          adapterConfig: {
            model: form.model,
            effort: form.effort !== "none" ? form.effort : undefined,
            cwd: form.cwd || undefined,
            disallowedTools: mergeDisallowed(form.disallowedTools, disabledMcpTools),
            promptTemplate: form.promptTemplate || undefined,
            defaultPrompt: form.defaultPrompt || undefined,
            useChrome,
            persistLogs,
            reviewDecisions,
            memoryEnabled,
            maxTurnsPerRun: Number(form.maxTurnsPerRun),
          },
          runtimeConfig: cronValue
            ? { heartbeat: { enabled: true, cron: cronValue } }
            : { heartbeat: { enabled: false } },
        }),
      });
      if (!persistLogs) clearAgent(id);
      router.push(`/agents/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save agent");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
          <Settings2 className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-xl font-semibold leading-none">Edit Agent</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Update config, prompt, or schedule. Changes take effect immediately.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* Row 1 — Identity + Adapter + MCP */}
        <div className="grid grid-cols-3 gap-4 items-stretch">

          {/* Step 1: Identity */}
          <Card>
            <StepHeader step={1} title="Identity" description="Who is this agent?" />
            <CardContent className="space-y-4 pt-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  required
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  readOnly={isControlTower}
                  className={isControlTower ? "opacity-60 cursor-not-allowed" : ""}
                />
                {isControlTower && (
                  <p className="text-xs text-muted-foreground">The Control Tower's name is fixed.</p>
                )}
              </div>
              {!isControlTower && (
                <div className="space-y-1.5">
                  <Label htmlFor="role">Role</Label>
                  <Select value={form.role} onValueChange={(v) => set("role", v)}>
                    <SelectTrigger id="role"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => <SelectItem key={r.id} value={r.name} className="capitalize">{r.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {!isControlTower && (
                <div className="space-y-1.5">
                  <Label htmlFor="title">Title <span className="text-muted-foreground">(optional)</span></Label>
                  <Input id="title" value={form.title} onChange={(e) => set("title", e.target.value)} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="capabilities">Capabilities <span className="text-muted-foreground">(optional)</span></Label>
                <Textarea id="capabilities" value={form.capabilities} onChange={(e) => set("capabilities", e.target.value)} rows={3} />
              </div>
              {!isControlTower && (
                <div className="space-y-1.5">
                  <Label htmlFor="reportsTo">Reports To <span className="text-muted-foreground">(optional)</span></Label>
                  <Select value={reportsToId} onValueChange={setReportsToId}>
                    <SelectTrigger id="reportsTo"><SelectValue placeholder="None (top-level)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None (top-level)</SelectItem>
                      {agents.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name} <span className="text-muted-foreground capitalize">({a.role})</span></SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Step 2: Adapter */}
          <Card>
            <StepHeader step={2} title="Adapter Config" description="How the agent is invoked" />
            <CardContent className="space-y-4 pt-4">
              <div className="space-y-1.5">
                <Label htmlFor="model">Model</Label>
                <Select value={form.model} onValueChange={(v) => set("model", v)}>
                  <SelectTrigger id="model"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODELS.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="effort">Effort</Label>
                <Select value={form.effort} onValueChange={(v) => set("effort", v)}>
                  <SelectTrigger id="effort"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Default</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="max">Max</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Controls thinking depth via <code className="font-mono">--effort</code>. Default lets Claude decide.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="maxTurns">Max Turns Per Run</Label>
                <Input id="maxTurns" type="number" min={1} max={100} value={form.maxTurnsPerRun} onChange={(e) => set("maxTurnsPerRun", e.target.value)} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="useChrome">Chrome Browser</Label>
                  <p className="text-xs text-muted-foreground">Enable browser automation via <code className="font-mono">--chrome</code></p>
                </div>
                <Switch id="useChrome" checked={useChrome} onCheckedChange={setUseChrome} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="persistLogs">Stream History</Label>
                  <p className="text-xs text-muted-foreground">Show this agent's logs in the Stream panel and history</p>
                </div>
                <Switch id="persistLogs" checked={persistLogs} onCheckedChange={setPersistLogs} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="reviewDecisions">Review Previous Decisions</Label>
                  <p className="text-xs text-muted-foreground">Agent reviews its own past decisions before making a new one</p>
                </div>
                <Switch id="reviewDecisions" checked={reviewDecisions} onCheckedChange={setReviewDecisions} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="memoryEnabled">Active Memory</Label>
                    <p className="text-xs text-muted-foreground">Share one Claude session across chat + scheduled runs</p>
                  </div>
                  <Switch id="memoryEnabled" checked={memoryEnabled} onCheckedChange={setMemoryEnabled} />
                </div>
                {memoryEnabled && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                    <p className="font-medium">Runs will no longer be clean.</p>
                    <p className="text-amber-600/80 dark:text-amber-400/80 mt-0.5">
                      Every run carries the full chat + prior-run history. Context grows unbounded — reset memory periodically to keep runs fast and predictable.
                    </p>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prompt">SKILL.md <span className="text-muted-foreground">(optional)</span></Label>
                <Textarea id="prompt" value={form.promptTemplate} onChange={(e) => set("promptTemplate", e.target.value)} rows={12} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="defaultPrompt">Default Prompt <span className="text-muted-foreground">(optional)</span></Label>
                <Textarea
                  id="defaultPrompt"
                  value={form.defaultPrompt}
                  onChange={(e) => set("defaultPrompt", e.target.value)}
                  placeholder="Analyze BTC/USDT on the 4h timeframe and provide a trade decision."
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">The task passed to the agent on every run. Use this for runtime context like asset, timeframe, or extra instructions.</p>
              </div>
            </CardContent>
          </Card>

          {/* Step 3: MCP & Workspace */}
          <Card>
            <StepHeader step={3} title="MCP & Workspace" description="Tools and environment" />
            <CardContent className="space-y-4 pt-4">
              {!isControlTower && (
                <div className="space-y-1.5">
                  <Label>MCP Servers</Label>
                  <Select value={mcpPreset} onValueChange={handleMcpPreset}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="global">Global (~/.claude config)</SelectItem>
                      <SelectItem value="builtin">Built-in (muxai-io servers)</SelectItem>
                    </SelectContent>
                  </Select>
                  {mcpPreset === "builtin" && (
                    <p className="text-xs text-muted-foreground">
                      Agent gets access to all built-in MCP servers. See the <a href="/mcp-servers" className="underline">MCP Servers</a> page for what's available.
                    </p>
                  )}
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="cwd">Workspace Directory <span className="text-muted-foreground">(optional)</span></Label>
                <Input
                  id="cwd"
                  value={form.cwd}
                  onChange={(e) => set("cwd", e.target.value)}
                  placeholder="/path/to/workspace"
                  readOnly={mcpPreset === "builtin"}
                  className={mcpPreset === "builtin" ? "opacity-60 cursor-not-allowed" : ""}
                />
                {mcpPreset === "builtin" ? (
                  <p className="text-xs text-muted-foreground">Auto-set to the muxai-io root so built-in MCP servers are discoverable.</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Override the default working directory for this agent.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="disallowedTools">
                  Disallowed Tools <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="disallowedTools"
                  value={form.disallowedTools}
                  onChange={(e) => set("disallowedTools", e.target.value)}
                  placeholder="e.g. Read,Bash,Edit"
                />
                <p className="text-xs text-muted-foreground">Comma-separated list of tools the agent cannot use. Keeps agents focused on MCP tools only.</p>
              </div>
              {mcpPreset === "builtin" && builtInServers.length > 0 && (
                <div className="space-y-2">
                  <Label>MCP Tool Access</Label>
                  <p className="text-xs text-muted-foreground">Toggle MCP servers or individual tools. Disabled items are added to the disallowed list.</p>
                  <div className="space-y-1 max-h-64 overflow-y-auto rounded-md border p-2">
                    {builtInServers
                      .filter((s) => {
                        if (isControlTower) return s.id !== "wallet" && s.id !== "orchestrator";
                        return s.id !== "control-tower";
                      })
                      .map((server) => {
                      const isLockedServer = isControlTower && server.id === "control-tower";
                      const serverToolNames = server.tools.map((t) => t.fullName);
                      const allDisabled = serverToolNames.length > 0 && serverToolNames.every((t) => disabledMcpTools.has(t));
                      const someDisabled = serverToolNames.some((t) => disabledMcpTools.has(t));

                      function toggleServer() {
                        if (isLockedServer) return;
                        setDisabledMcpTools((prev) => {
                          const next = new Set(prev);
                          if (allDisabled) {
                            serverToolNames.forEach((t) => next.delete(t));
                          } else {
                            serverToolNames.forEach((t) => next.add(t));
                          }
                          return next;
                        });
                      }

                      function toggleTool(fullName: string) {
                        if (isControlTower && fullName.startsWith("mcp__control-tower__")) return;
                        setDisabledMcpTools((prev) => {
                          const next = new Set(prev);
                          if (next.has(fullName)) {
                            next.delete(fullName);
                          } else {
                            next.add(fullName);
                          }
                          return next;
                        });
                      }

                      return (
                        <div key={server.id}>
                          <button
                            type="button"
                            onClick={toggleServer}
                            disabled={isLockedServer}
                            title={isLockedServer ? "The Control Tower cannot disable its own admin tools." : undefined}
                            className={`flex items-center gap-2 w-full text-left py-1 px-1 rounded text-sm font-medium ${isLockedServer ? "cursor-not-allowed opacity-80" : "hover:bg-muted"}`}
                          >
                            <span className={`h-3 w-3 rounded-sm border flex items-center justify-center ${allDisabled ? "bg-destructive border-destructive" : someDisabled ? "bg-yellow-500/50 border-yellow-500" : "bg-primary border-primary"}`}>
                              {allDisabled ? <span className="text-[9px] text-destructive-foreground">&#x2715;</span> : <span className="text-[9px] text-primary-foreground">&#x2713;</span>}
                            </span>
                            {server.label}
                            {isLockedServer && <Lock className="h-3 w-3 text-muted-foreground ml-1" />}
                          </button>
                          <div className="ml-5 space-y-0.5">
                            {server.tools.map((tool) => {
                              const isDisabled = disabledMcpTools.has(tool.fullName);
                              const isLockedTool = isControlTower && tool.fullName.startsWith("mcp__control-tower__");
                              return (
                                <button
                                  key={tool.fullName}
                                  type="button"
                                  onClick={() => toggleTool(tool.fullName)}
                                  disabled={isLockedTool}
                                  title={isLockedTool ? "Required for Control Tower — cannot be disabled." : tool.description}
                                  className={`flex items-center gap-2 w-full text-left py-0.5 px-1 rounded ${isLockedTool ? "cursor-not-allowed opacity-80" : "hover:bg-muted"}`}
                                >
                                  <span className={`h-2.5 w-2.5 rounded-sm border flex items-center justify-center ${isDisabled ? "bg-destructive border-destructive" : "bg-primary border-primary"}`}>
                                    {isDisabled ? <span className="text-[8px] text-destructive-foreground">&#x2715;</span> : <span className="text-[8px] text-primary-foreground">&#x2713;</span>}
                                  </span>
                                  <span className="text-xs text-muted-foreground font-mono">{tool.name}</span>
                                  {isLockedTool && <Lock className="h-2.5 w-2.5 text-muted-foreground ml-auto" />}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>

            <StepHeader step={4} title="Schedule" description="Run this agent automatically on a timer" />
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center gap-4">
                <div className="w-full">
                  <Select value={schedulePreset} onValueChange={handleSchedulePreset}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SCHEDULE_PRESETS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {schedulePreset === "custom" && (
                <Input value={form.customCron} onChange={(e) => set("customCron", e.target.value)} placeholder="*/30 * * * *" />
              )}
              {schedulePreset !== "disabled" && schedulePreset !== "custom" && (
                <p className="text-xs text-muted-foreground font-mono">{schedulePreset}</p>
              )}
              {schedulePreset !== "disabled" && (
                <p className="text-xs text-muted-foreground">The agent will be invoked automatically on this schedule. It skips a run if already running.</p>
              )}
            </CardContent>
          </Card>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-3">
          <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button>
          <Button type="button" variant="outline" onClick={() => router.push(`/agents/${id}`)}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
