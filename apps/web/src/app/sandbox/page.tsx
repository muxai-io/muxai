"use client";
import { useEffect, useRef, useState } from "react";
import { API_URL, API_KEY } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Play, Square, ChevronDown, ChevronUp, FlaskConical, RotateCcw } from "lucide-react";

interface OutputLine {
  id: number;
  text: string;
  kind: "text" | "tool" | "error" | "system";
}

interface Turn {
  id: number;
  prompt: string;
  lines: OutputLine[];
  done: boolean;
  status?: "succeeded" | "failed";
}

let lineId = 0;
let turnId = 0;

export default function SandboxPage() {
  const [prompt, setPrompt] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [showSystem, setShowSystem] = useState(false);
  const [model, setModel] = useState("claude-sonnet-4-6");
  const [useMcp, setUseMcp] = useState(true);
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const esRef = useRef<EventSource | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll as output grows
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  function classifyLine(text: string): OutputLine["kind"] {
    if (text.startsWith("▶")) return "tool";
    if (text.startsWith("✗")) return "error";
    return "text";
  }

  async function handleRun() {
    if (!prompt.trim() || running) return;

    const currentPrompt = prompt;
    setPrompt("");
    setRunning(true);

    const newTurnId = turnId++;
    setTurns((prev) => [...prev, { id: newTurnId, prompt: currentPrompt, lines: [], done: false }]);

    const res = await fetch(`${API_URL}/api/sandbox/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(API_KEY ? { "X-Api-Key": API_KEY } : {}) },
      body: JSON.stringify({
        model,
        systemPrompt: systemPrompt || undefined,
        prompt: currentPrompt,
        useMcp,
        sessionId: sessionId || undefined,
      }),
    });

    if (!res.ok) {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === newTurnId
            ? { ...t, lines: [{ id: lineId++, text: "Failed to start sandbox run.", kind: "error" }], done: true, status: "failed" }
            : t
        )
      );
      setRunning(false);
      return;
    }

    const { runId: id } = await res.json();
    setRunId(id);

    const es = new EventSource(`${API_URL}/api/sandbox/${id}/stream`);
    esRef.current = es;

    es.onmessage = (e) => {
      let event: { type: string; data?: string; status?: string; sessionId?: string };
      try { event = JSON.parse(e.data); } catch { return; }

      if (event.type === "session" && event.sessionId) {
        setSessionId(event.sessionId);
      }

      if (event.type === "log" && event.data) {
        const lines = event.data.split("\n").filter((l) => l.trim());
        setTurns((prev) =>
          prev.map((t) =>
            t.id === newTurnId
              ? { ...t, lines: [...t.lines, ...lines.map((text) => ({ id: lineId++, text, kind: classifyLine(text) } as OutputLine))] }
              : t
          )
        );
      }

      if (event.type === "done") {
        const succeeded = event.status === "succeeded";
        setTurns((prev) =>
          prev.map((t) =>
            t.id === newTurnId ? { ...t, done: true, status: succeeded ? "succeeded" : "failed" } : t
          )
        );
        setRunning(false);
        es.close();
        esRef.current = null;
      }
    };

    es.onerror = () => {
      setRunning(false);
      setTurns((prev) =>
        prev.map((t) =>
          t.id === newTurnId && !t.done
            ? { ...t, lines: [...t.lines, { id: lineId++, text: "Connection lost.", kind: "error" as const }], done: true, status: "failed" as const }
            : t
        )
      );
      es.close();
      esRef.current = null;
    };
  }

  async function handleStop() {
    if (!runId) return;
    esRef.current?.close();
    esRef.current = null;
    await fetch(`${API_URL}/api/sandbox/stop/${runId}`, { method: "POST", headers: { ...(API_KEY ? { "X-Api-Key": API_KEY } : {}) } });
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.done) return prev;
      return prev.map((t, i) =>
        i === prev.length - 1
          ? { ...t, lines: [...t.lines, { id: lineId++, text: "— Stopped", kind: "system" as const }], done: true, status: "failed" as const }
          : t
      );
    });
    setRunning(false);
    setRunId(null);
  }

  function handleNewSession() {
    esRef.current?.close();
    esRef.current = null;
    setSessionId(null);
    setTurns([]);
    setPrompt("");
    setSystemPrompt("");
    setRunning(false);
    setRunId(null);
  }

  const hasContent = turns.length > 0;

  return (
    <div className="flex flex-col h-full gap-0">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-400">
            <FlaskConical className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-none">Sandbox</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {sessionId ? (
                <span className="text-violet-400/70">Session active — conversation persists until reset</span>
              ) : (
                "Ephemeral — nothing is saved"
              )}
            </p>
          </div>
        </div>
        {hasContent && (
          <Button variant="ghost" size="sm" className="text-muted-foreground gap-1.5" onClick={handleNewSession}>
            <RotateCcw className="h-3.5 w-3.5" />
            New Session
          </Button>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">

        {/* Left — Config + Input */}
        <div className="flex flex-col gap-4 lg:w-80 shrink-0">

          {/* Config bar */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Model</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude-sonnet-4-6">Claude Sonnet 4.6</SelectItem>
                  <SelectItem value="claude-opus-4-6">Claude Opus 4.6</SelectItem>
                  <SelectItem value="claude-haiku-4-5-20251001">Claude Haiku 4.5</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs text-muted-foreground">Built-in MCP</Label>
                <p className="text-xs text-muted-foreground/60 mt-0.5">Tools + custom servers</p>
              </div>
              <Switch checked={useMcp} onCheckedChange={setUseMcp} />
            </div>

            {/* System prompt toggle */}
            <div>
              <button
                type="button"
                onClick={() => setShowSystem((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {showSystem ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                System prompt {systemPrompt && <span className="text-violet-400">•</span>}
              </button>
              {showSystem && (
                <Textarea
                  className="mt-2 text-xs font-mono"
                  rows={5}
                  placeholder="Optional system instructions..."
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                />
              )}
            </div>
          </div>

          {/* Prompt input */}
          <div className="flex flex-col gap-2 flex-1">
            <Textarea
              className="flex-1 resize-none text-sm min-h-32"
              placeholder={sessionId ? "Continue the conversation…" : "Ask anything... or paste a SKILL.md prompt to test it"}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleRun();
              }}
              disabled={running}
            />
            <div className="flex gap-2">
              {running ? (
                <Button onClick={handleStop} variant="destructive" className="flex-1 gap-2">
                  <Square className="h-4 w-4" />
                  Stop
                </Button>
              ) : (
                <Button onClick={handleRun} disabled={!prompt.trim()} className="flex-1 gap-2">
                  <Play className="h-4 w-4" />
                  {sessionId ? "Send" : "Run"}
                  <span className="text-xs opacity-60 hidden sm:inline">⌘↵</span>
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Right — Conversation Output */}
        <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-border bg-card overflow-hidden">
          {!hasContent && !running ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-muted-foreground/40">
              <FlaskConical className="h-8 w-8 mb-3" />
              <p className="text-sm">Output appears here</p>
              <p className="text-xs mt-1">Press ⌘↵ to run</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {turns.map((turn) => (
                <div key={turn.id} className="space-y-2">
                  {/* User prompt bubble */}
                  <div className="flex justify-end">
                    <div className="max-w-[80%] rounded-xl rounded-tr-sm bg-primary/10 border border-primary/20 px-3 py-2 text-sm text-foreground/90 whitespace-pre-wrap">
                      {turn.prompt}
                    </div>
                  </div>

                  {/* Assistant response */}
                  {(turn.lines.length > 0 || !turn.done) && (
                    <div className="flex justify-start">
                      <div className="max-w-[92%] rounded-xl rounded-tl-sm border border-border bg-muted/30 px-3 py-2 font-mono text-xs space-y-0.5">
                        {!turn.done && turn.lines.length === 0 && (
                          <p className="text-muted-foreground/50 italic animate-pulse">Thinking…</p>
                        )}
                        {turn.lines.map((line) => (
                          <div
                            key={line.id}
                            className={
                              line.kind === "tool" ? "text-blue-400/80" :
                              line.kind === "error" ? "text-red-400" :
                              line.kind === "system" ? "text-muted-foreground/50 italic" :
                              "text-foreground/85"
                            }
                          >
                            <span className="whitespace-pre-wrap">{line.text}</span>
                          </div>
                        ))}
                        {!turn.done && turn.lines.length > 0 && (
                          <span className="inline-block h-3.5 w-0.5 bg-foreground/60 animate-pulse ml-0.5" />
                        )}
                        {turn.done && turn.status === "failed" && turn.lines.every(l => l.kind !== "error") && (
                          <p className="text-red-400/70 italic">✗ Failed</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
