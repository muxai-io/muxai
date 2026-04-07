"use client";
import { useEffect, useState } from "react";
import { apiFetch, cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Check, Copy, Trash2, Plus, Plug, ChevronDown, ChevronRight, Zap, Loader2 } from "lucide-react";

interface McpTool { name: string; fullName: string; description: string; }
interface BuiltinServer { id: string; label: string; description: string; command: string; args: string[]; tools: McpTool[]; }
interface CustomServer { id: string; name: string; label: string; command: string; args: string[]; headers?: Record<string, string>; description?: string; }

interface McpRegistryResponse {
  rootPath: string;
  servers: BuiltinServer[];
  customServers: CustomServer[];
}

type Tab = "builtin" | "custom" | "all";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <Button variant="ghost" size="sm" onClick={copy} className="h-7 gap-1.5 text-xs">
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

interface ParsedServer {
  name: string; label: string; command: string; args: string[];
  headers?: Record<string, string>; description?: string;
}

function isSingleServerConfig(obj: Record<string, unknown>): boolean {
  return typeof obj.type === "string" || typeof obj.url === "string" || typeof obj.command === "string";
}

function deriveServerName(obj: Record<string, unknown>): string {
  if (typeof obj.url === "string") {
    try { return new URL(obj.url as string).hostname.split(".")[0]; } catch {}
  }
  return "custom-server";
}

function parseMcpJson(raw: string): ParsedServer[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { throw new Error("Invalid JSON — check your syntax"); }

  // Single flat server: { "type": "http", "url": "...", ... }
  if (isSingleServerConfig(parsed)) {
    const name = deriveServerName(parsed);
    const isHttp = parsed.type === "http" || typeof parsed.url === "string";
    return [{
      name, label: name,
      command: isHttp ? (parsed.url as string) : (parsed.command as string) ?? "",
      args: isHttp ? [] : (parsed.args as string[]) ?? [],
      headers: isHttp && parsed.headers ? (parsed.headers as Record<string, string>) : undefined,
    }];
  }

  // Wrapped format: { "mcpServers": { "name": { ... } } }
  const servers: Record<string, unknown> = parsed.mcpServers ?? parsed;
  return Object.entries(servers).map(([name, cfg]) => {
    const c = cfg as Record<string, unknown>;
    const isHttp = c.type === "http" || typeof c.url === "string";
    return {
      name, label: name,
      command: isHttp ? (c.url as string) : (c.command as string) ?? "",
      args: isHttp ? [] : (c.args as string[]) ?? [],
      headers: isHttp && c.headers ? (c.headers as Record<string, string>) : undefined,
    };
  });
}

const BLANK_FORM = { name: "", label: "", command: "", args: "", headers: "", description: "" };

export default function McpServersPage() {
  const [data, setData] = useState<McpRegistryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [addMode, setAddMode] = useState<"manual" | "json">("json");
  const [form, setForm] = useState(BLANK_FORM);
  const [jsonInput, setJsonInput] = useState("");
  const [parsed, setParsed] = useState<ParsedServer[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; serverName?: string; tools?: { name: string; description?: string }[]; error?: string }>>({});

  function load() {
    apiFetch<McpRegistryResponse>("/api/mcp-servers")
      .then(setData)
      .catch(() => setError("Failed to load MCP servers"));
  }

  useEffect(() => { load(); }, []);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const { rootPath, servers, customServers } = data;

  function globalSnippet(server: BuiltinServer): string {
    const absoluteArgs = server.args.map((a) =>
      a.startsWith("/") || /^[A-Za-z]:/.test(a) ? a : `${rootPath}/${a}`.replace(/\\/g, "/")
    );
    return JSON.stringify({ mcpServers: { [server.id]: { command: server.command, args: absoluteArgs } } }, null, 2);
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleParse() {
    setParseError(null); setParsed(null);
    try {
      const result = parseMcpJson(jsonInput);
      if (result.length === 0) throw new Error("No servers found in JSON");
      setParsed(result);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Invalid JSON");
    }
  }

  async function handleImportJson() {
    if (!parsed) return;
    setSaving(true); setFormError(null);
    try {
      for (const s of parsed) {
        await apiFetch("/api/mcp-servers", {
          method: "POST",
          body: JSON.stringify({ name: s.name, label: s.label, command: s.command, args: s.args, headers: s.headers, description: s.description }),
        });
      }
      setJsonInput(""); setParsed(null); setShowAdd(false); load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to import");
    } finally { setSaving(false); }
  }

  async function handleAddManual(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setFormError(null);
    try {
      const args = form.args.split("\n").map((a) => a.trim()).filter(Boolean);
      let headers: Record<string, string> | undefined;
      if (form.headers.trim()) {
        try { headers = JSON.parse(form.headers); } catch { throw new Error("Invalid JSON in headers field"); }
      }
      await apiFetch("/api/mcp-servers", {
        method: "POST",
        body: JSON.stringify({ name: form.name, label: form.label, command: form.command, args, headers, description: form.description || undefined }),
      });
      setForm(BLANK_FORM); setShowAdd(false); load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to add server");
    } finally { setSaving(false); }
  }

  async function handleTest(id: string) {
    setTesting(id);
    setTestResults((prev) => { const next = { ...prev }; delete next[id]; return next; });
    try {
      const result = await apiFetch<{ ok: boolean; serverName?: string; tools?: { name: string; description?: string }[]; error?: string }>(`/api/mcp-servers/${id}/test`, { method: "POST" });
      setTestResults((prev) => ({ ...prev, [id]: result }));
    } catch (err) {
      setTestResults((prev) => ({ ...prev, [id]: { ok: false, error: err instanceof Error ? err.message : "Test failed" } }));
    } finally { setTesting(null); }
  }

  async function handleDelete(id: string) {
    await apiFetch(`/api/mcp-servers/${id}`, { method: "DELETE" });
    load();
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "builtin", label: "Built-in" },
    { key: "custom", label: "Custom" },
    { key: "all", label: "All" },
  ];

  const showBuiltin = tab === "builtin" || tab === "all";
  const showCustom  = tab === "custom"  || tab === "all";

  return (
    <div className="space-y-6">

      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
          <Plug className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-xl font-semibold leading-none">MCP Servers</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Built-in servers are bundled with muxai-io. Custom servers are registered by you and injected into all built-in agents.
          </p>
        </div>
      </div>

      {/* Tabs + Add button */}
      <div className="flex items-center justify-between">
        <div className="flex rounded-lg border border-border overflow-hidden text-sm">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "px-4 py-1.5 transition-colors",
                tab === key ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setShowAdd((v) => !v)}>
          <Plus className="h-3.5 w-3.5" />
          Add Server
        </Button>
      </div>

      {/* Add form */}
      {showAdd && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base">Add Custom MCP Server</CardTitle>
                <CardDescription>Register any MCP server — stdio or HTTP — available to all built-in agents.</CardDescription>
              </div>
              <div className="flex rounded-md border border-border overflow-hidden shrink-0 text-xs">
                <button type="button" onClick={() => setAddMode("json")} className={cn("px-3 py-1.5 transition-colors", addMode === "json" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>Paste JSON</button>
                <button type="button" onClick={() => setAddMode("manual")} className={cn("px-3 py-1.5 transition-colors", addMode === "manual" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>Manual</button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {addMode === "json" ? (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Paste MCP config JSON</Label>
                  <Textarea rows={8} className="font-mono text-xs" placeholder={'{\n  "mcpServers": {\n    "my-server": {\n      "type": "http",\n      "url": "https://...",\n      "headers": { "Authorization": "Bearer ..." }\n    }\n  }\n}'} value={jsonInput} onChange={(e) => { setJsonInput(e.target.value); setParsed(null); setParseError(null); }} />
                </div>
                {parseError && <p className="text-sm text-destructive">{parseError}</p>}
                {parsed && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Found {parsed.length} server{parsed.length > 1 ? "s" : ""}</p>
                    {parsed.map((s) => (
                      <div key={s.name} className="rounded-md border border-border p-3 space-y-1 text-xs">
                        <div className="flex items-center gap-2">
                          <code className="bg-muted px-1.5 py-0.5 rounded">{s.name}</code>
                          <Badge variant="outline" className="text-xs">{s.command.startsWith("http") ? "http" : "stdio"}</Badge>
                        </div>
                        <p className="text-muted-foreground truncate">{s.command}</p>
                        {s.headers && <p className="text-muted-foreground">Headers: {Object.keys(s.headers).join(", ")}</p>}
                      </div>
                    ))}
                  </div>
                )}
                {formError && <p className="text-sm text-destructive">{formError}</p>}
                <div className="flex gap-2">
                  {!parsed
                    ? <Button type="button" onClick={handleParse} disabled={!jsonInput.trim()}>Parse</Button>
                    : <Button type="button" onClick={handleImportJson} disabled={saving}>{saving ? "Importing…" : `Import ${parsed.length} server${parsed.length > 1 ? "s" : ""}`}</Button>
                  }
                  <Button type="button" variant="outline" onClick={() => { setShowAdd(false); setJsonInput(""); setParsed(null); setParseError(null); }}>Cancel</Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleAddManual} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Server key *</Label>
                    <Input id="name" required placeholder="e.g. svs-api" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                    <p className="text-xs text-muted-foreground">Unique key used in the MCP config</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="label">Display name *</Label>
                    <Input id="label" required placeholder="e.g. Solana Vibe Station" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="command">Command / URL *</Label>
                  <Input id="command" required placeholder="node, npx, or https://..." value={form.command} onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))} />
                  <p className="text-xs text-muted-foreground">For HTTP servers paste the full URL; leave args empty.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="args">Args <span className="text-muted-foreground">(one per line, stdio only)</span></Label>
                  <Textarea id="args" rows={2} placeholder="/absolute/path/to/server.js" value={form.args} onChange={(e) => setForm((f) => ({ ...f, args: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="headers">Headers <span className="text-muted-foreground">(JSON, HTTP only)</span></Label>
                  <Textarea id="headers" rows={2} className="font-mono text-xs" placeholder={'{ "Authorization": "Bearer ..." }'} value={form.headers} onChange={(e) => setForm((f) => ({ ...f, headers: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="description">Description <span className="text-muted-foreground">(optional)</span></Label>
                  <Input id="description" placeholder="What does this server provide?" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
                </div>
                {formError && <p className="text-sm text-destructive">{formError}</p>}
                <div className="flex gap-2">
                  <Button type="submit" disabled={saving}>{saving ? "Adding…" : "Add Server"}</Button>
                  <Button type="button" variant="outline" onClick={() => { setShowAdd(false); setForm(BLANK_FORM); }}>Cancel</Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      {/* Built-in cards */}
      {showBuiltin && servers.length > 0 && (
        <div className="space-y-3">
          {tab === "all" && <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Built-in</p>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {servers.map((server) => {
              const open = expanded.has(server.id);
              return (
                <Card key={server.id} className="cursor-pointer" onClick={() => toggleExpand(server.id)}>
                  <CardHeader className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="text-sm">{server.label}</CardTitle>
                        <CardDescription className="text-xs mt-0.5 line-clamp-2">{server.description}</CardDescription>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant="secondary" className="text-xs">built-in</Badge>
                        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                      </div>
                    </div>
                  </CardHeader>
                  {open && (
                    <CardContent className="space-y-4 px-4 pb-4 pt-0" onClick={(e) => e.stopPropagation()}>
                      {/* Tools */}
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tools</p>
                        <div className="space-y-1.5">
                          {server.tools.map((tool) => (
                            <div key={tool.name} className="rounded-md border p-2.5 space-y-1">
                              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{tool.fullName}</code>
                              <p className="text-xs text-muted-foreground">{tool.description}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                      {/* Global config snippet */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Global config</p>
                          <CopyButton text={globalSnippet(server)} />
                        </div>
                        <pre className="p-3 text-xs overflow-x-auto rounded-md bg-muted">{globalSnippet(server)}</pre>
                      </div>
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Custom cards */}
      {showCustom && (
        <div className="space-y-3">
          {tab === "all" && <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Custom</p>}
          {customServers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No custom servers yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {customServers.map((server) => {
                const result = testResults[server.id];
                return (
                  <Card key={server.id}>
                    <CardHeader className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <CardTitle className="text-sm">{server.label}</CardTitle>
                          {server.description && <CardDescription className="text-xs mt-0.5">{server.description}</CardDescription>}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge variant="outline" className="text-xs">custom</Badge>
                          <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-emerald-400" onClick={() => handleTest(server.id)} disabled={testing === server.id} title="Test connection">
                            {testing === server.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                          </Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(server.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 pt-0 space-y-3">
                      <pre className="p-2.5 text-xs overflow-x-auto rounded-md bg-muted">{JSON.stringify(
                        server.command.startsWith("http")
                          ? { type: "http", url: server.command, ...(server.headers ? { headers: server.headers } : {}) }
                          : { command: server.command, args: server.args },
                        null, 2
                      )}</pre>
                      {result && (
                        <div className={cn("rounded-md border p-3 text-xs space-y-2", result.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5")}>
                          {result.ok ? (
                            <>
                              <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
                                <Check className="h-3 w-3" />
                                Connected{result.serverName ? ` — ${result.serverName}` : ""}
                              </div>
                              {result.tools && result.tools.length > 0 ? (
                                <div className="space-y-1">
                                  <p className="text-muted-foreground">{result.tools.length} tool{result.tools.length !== 1 ? "s" : ""} available:</p>
                                  {result.tools.map((t) => (
                                    <div key={t.name} className="flex items-baseline gap-2">
                                      <code className="bg-muted px-1 py-0.5 rounded shrink-0">{t.name}</code>
                                      {t.description && <span className="text-muted-foreground truncate">{t.description}</span>}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-muted-foreground">Server responded successfully. Tool discovery not available.</p>
                              )}
                            </>
                          ) : (
                            <div className="text-destructive">
                              <span className="font-medium">Connection failed: </span>{result.error}
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
