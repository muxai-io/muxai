"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { API_URL, API_KEY, apiFetch, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageSquare, Play, Square, RotateCcw, Cpu, Radar } from "lucide-react";

interface Agent {
  id: string;
  name: string;
  role: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: string;
}

interface ChatSession {
  id: string;
  agentId: string | null;
  claudeSessionId: string | null;
}

interface StreamLine {
  id: number;
  text: string;
  kind: "text" | "tool" | "error";
}

let lineId = 0;

function classifyLine(text: string): StreamLine["kind"] {
  if (text.startsWith("▶")) return "tool";
  if (text.startsWith("✗")) return "error";
  return "text";
}

function AssistantContent({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <div
          key={i}
          className={
            line.startsWith("▶") ? "text-blue-400/80" :
            line.startsWith("✗") ? "text-red-400" :
            "text-foreground/85 whitespace-pre-wrap"
          }
        >
          {line || "\u00a0"}
        </div>
      ))}
    </>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatPageInner />
    </Suspense>
  );
}

function ChatPageInner() {
  const searchParams = useSearchParams();
  const agentParam = searchParams.get("agent");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [controlTowerId, setControlTowerId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>(agentParam ?? "general");

  useEffect(() => {
    if (agentParam && agentParam !== selectedId) setSelectedId(agentParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentParam]);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamLines, setStreamLines] = useState<StreamLine[]>([]);
  const [prompt, setPrompt] = useState("");
  const [useMcp, setUseMcp] = useState(true);
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<Agent[]>("/api/agents").catch(() => [] as Agent[]),
      apiFetch<{ agent: Agent | null }>("/api/control-tower").catch(() => ({ agent: null })),
    ]).then(([regular, { agent: tower }]) => {
      if (tower) {
        setAgents([tower, ...regular]);
        setControlTowerId(tower.id);
      } else {
        setAgents(regular);
      }
    });
  }, []);

  useEffect(() => {
    const agentId = selectedId === "general" ? undefined : selectedId;
    loadSession(agentId);
  }, [selectedId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamLines]);

  async function loadSession(agentId?: string) {
    const url = agentId ? `/api/chat/session?agentId=${agentId}` : "/api/chat/session";
    try {
      const data = await apiFetch<{ session: ChatSession; messages: ChatMessage[] }>(url);
      setSession(data.session);
      setMessages(data.messages);
      setStreamLines([]);
    } catch {
      setSession(null);
      setMessages([]);
      setStreamLines([{ id: lineId++, text: "Failed to load chat session. Check that the API is running.", kind: "error" }]);
    }
  }

  async function handleSend() {
    if (!prompt.trim() || running || !session) return;
    const currentPrompt = prompt;
    setPrompt("");
    setRunning(true);
    setStreamLines([]);

    // Optimistically show user message
    setMessages((prev) => [...prev, {
      id: `temp-${Date.now()}`,
      role: "user",
      content: currentPrompt,
      ts: new Date().toISOString(),
    }]);

    const agentId = selectedId === "general" ? undefined : selectedId;

    const res = await fetch(`${API_URL}/api/chat/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(API_KEY ? { "X-Api-Key": API_KEY } : {}) },
      body: JSON.stringify({ chatSessionId: session.id, prompt: currentPrompt, agentId, useMcp: agentId ? true : useMcp }),
    });

    if (!res.ok) {
      setStreamLines([{ id: lineId++, text: "Failed to send message.", kind: "error" }]);
      setRunning(false);
      return;
    }

    const { runId: id } = await res.json();
    setRunId(id);

    const es = new EventSource(`${API_URL}/api/chat/${id}/stream`);
    esRef.current = es;

    es.onmessage = (e) => {
      let event: { type: string; data?: string; status?: string };
      try { event = JSON.parse(e.data); } catch { return; }

      if (event.type === "log" && event.data) {
        const lines = event.data.split("\n").filter((l) => l.trim());
        setStreamLines((prev) => [
          ...prev,
          ...lines.map((text) => ({ id: lineId++, text, kind: classifyLine(text) } as StreamLine)),
        ]);
      }

      if (event.type === "done") {
        setRunning(false);
        es.close();
        esRef.current = null;
        setRunId(null);
        // Reload from DB — assistant message is now saved
        loadSession(agentId);
      }
    };

    es.onerror = () => {
      setRunning(false);
      setStreamLines((prev) => [...prev, { id: lineId++, text: "Connection lost.", kind: "error" }]);
      es.close();
      esRef.current = null;
    };
  }

  async function handleStop() {
    if (!runId) return;
    esRef.current?.close();
    esRef.current = null;
    await fetch(`${API_URL}/api/chat/stop/${runId}`, {
      method: "POST",
      headers: { ...(API_KEY ? { "X-Api-Key": API_KEY } : {}) },
    });
    setRunning(false);
    setRunId(null);
    const agentId = selectedId === "general" ? undefined : selectedId;
    loadSession(agentId);
  }

  async function handleReset() {
    if (!session) return;
    esRef.current?.close();
    esRef.current = null;
    setRunning(false);
    setRunId(null);
    await apiFetch(`/api/chat/session/${session.id}/reset`, { method: "POST" });
    const agentId = selectedId === "general" ? undefined : selectedId;
    loadSession(agentId);
  }

  const selectedAgent = agents.find((a) => a.id === selectedId);
  const hasContent = messages.length > 0 || streamLines.length > 0;
  const isControlTower = controlTowerId !== null && selectedId === controlTowerId;

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
              isControlTower
                ? "bg-red-500/10 text-red-400 ring-1 ring-red-500/30 shadow-[0_0_18px_rgba(239,68,68,0.35)]"
                : "bg-emerald-500/10 text-emerald-400",
            )}
          >
            {isControlTower ? <Radar className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-none">Chat</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isControlTower
                ? "Talking to Control Tower · admin"
                : selectedId === "general"
                ? "General — persistent memory"
                : `Talking to ${selectedAgent?.name ?? "…"}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedId === "general" && (
            <button
              onClick={() => setUseMcp((v) => !v)}
              title={useMcp ? "Built-in MCP enabled" : "Built-in MCP disabled"}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors ${useMcp ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-border bg-muted/50 text-muted-foreground"}`}
            >
              <Cpu className="h-3.5 w-3.5" />
              Built-in MCP
              <span className={`inline-block h-2 w-2 rounded-full ${useMcp ? "bg-emerald-400" : "bg-muted-foreground/40"}`} />
            </button>
          )}
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger
              className={cn(
                "h-8 w-48 text-sm",
                isControlTower && "border-red-500/40 text-red-400",
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="general">General</SelectItem>
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.id === controlTowerId ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-400 shadow-[0_0_6px_rgba(239,68,68,0.8)]" />
                      {a.name}
                    </span>
                  ) : (
                    a.name
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasContent && !running && (
            <Button variant="ghost" size="sm" className="text-muted-foreground gap-1.5" onClick={handleReset}>
              <RotateCcw className="h-3.5 w-3.5" />
              New
            </Button>
          )}
        </div>
      </div>

      {/* Chat thread */}
      <div
        className={cn(
          "flex-1 min-h-0 flex flex-col rounded-xl border bg-card overflow-hidden transition-shadow",
          isControlTower
            ? "border-red-500/40 shadow-[0_0_32px_rgba(239,68,68,0.18)]"
            : "border-border",
        )}
      >
        {!hasContent && !running ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-muted-foreground/40">
            <MessageSquare className="h-8 w-8 mb-3" />
            <p className="text-sm">
              {selectedId === "general" ? "Start a conversation" : `Chat with ${selectedAgent?.name ?? "an agent"}`}
            </p>
            <p className="text-xs mt-1">Memory persists across sessions · ⌘↵ to send</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* History */}
            {messages.map((msg) =>
              msg.role === "user" ? (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[80%] rounded-xl rounded-tr-sm bg-primary/10 border border-primary/20 px-3 py-2 text-sm text-foreground/90 whitespace-pre-wrap">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div key={msg.id} className="flex justify-start">
                  <div className="max-w-[92%] rounded-xl rounded-tl-sm border border-border bg-muted/30 px-3 py-2 font-mono text-xs space-y-0.5">
                    <AssistantContent content={msg.content} />
                  </div>
                </div>
              )
            )}

            {/* Live streaming response */}
            {(streamLines.length > 0 || running) && (
              <div className="flex justify-start">
                <div className="max-w-[92%] rounded-xl rounded-tl-sm border border-border bg-muted/30 px-3 py-2 font-mono text-xs space-y-0.5">
                  {running && streamLines.length === 0 && (
                    <p className="text-muted-foreground/50 italic animate-pulse">Thinking…</p>
                  )}
                  {streamLines.map((line) => (
                    <div
                      key={line.id}
                      className={
                        line.kind === "tool" ? "text-blue-400/80" :
                        line.kind === "error" ? "text-red-400" :
                        "text-foreground/85 whitespace-pre-wrap"
                      }
                    >
                      {line.text}
                    </div>
                  ))}
                  {running && streamLines.length > 0 && (
                    <span className="inline-block h-3.5 w-0.5 bg-foreground/60 animate-pulse ml-0.5" />
                  )}
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}

        {/* Input */}
        <div className="border-t border-border p-3 flex gap-2 items-end">
          <Textarea
            className="flex-1 resize-none text-sm min-h-[60px] max-h-32"
            placeholder={running ? "Waiting for response…" : "Type a message…"}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            disabled={running}
          />
          {running ? (
            <Button onClick={handleStop} variant="destructive" size="sm">
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleSend} disabled={!prompt.trim() || !session} size="sm" className="gap-1">
              <Play className="h-4 w-4" />
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
