"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/utils";

export type LogEntryKind = "text" | "tool" | "run_start" | "run_end";

export interface LogEntry {
  id: number;
  ts: number;
  agentName: string;
  agentId: string;
  kind: LogEntryKind;
  content: string;
  status?: "succeeded" | "failed";
}

type GlobalLogEvent =
  | { type: "log"; agentId: string; agentName: string; runId: string; data: string; ts: number }
  | { type: "run_start"; agentId: string; agentName: string; runId: string; ts: number }
  | { type: "run_end"; agentId: string; agentName: string; runId: string; status: "succeeded" | "failed"; ts: number };

interface LogStreamContext {
  entries: LogEntry[];
  activeRuns: number;
  clear: () => void;
  clearAgent: (agentId: string) => void;
}

const LogStreamCtx = createContext<LogStreamContext>({ entries: [], activeRuns: 0, clear: () => {}, clearAgent: () => {} });

const STORAGE_KEY = "muxai:stream-logs";
const MAX_STORED = 500;
let nextId = 0;

function loadFromStorage(): LogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LogEntry[]) : [];
  } catch {
    return [];
  }
}

function saveToStorage(entries: LogEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_STORED)));
  } catch {}
}

export function LogStreamProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [activeRuns, setActiveRuns] = useState(0);
  const loaded = useRef(false);

  // Load from localStorage on mount
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const stored = loadFromStorage();
    if (stored.length > 0) {
      nextId = Math.max(...stored.map((e) => e.id)) + 1;
      setEntries(stored);
    }
  }, []);

  // Persist to localStorage on change
  useEffect(() => {
    if (!loaded.current) return;
    saveToStorage(entries);
  }, [entries]);

  // SSE connection with auto-reconnect
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      es = new EventSource(`${API_URL}/api/logs/stream`);

      es.onmessage = (e) => {
        let event: GlobalLogEvent;
        try { event = JSON.parse(e.data); } catch { return; }

        if (event.type === "run_start") {
          setActiveRuns((n) => n + 1);
          setEntries((prev) => [
            { id: nextId++, ts: event.ts, agentName: event.agentName, agentId: event.agentId, kind: "run_start" as const, content: "started" },
            ...prev,
          ].slice(0, MAX_STORED));
          return;
        }

        if (event.type === "run_end") {
          setActiveRuns((n) => Math.max(0, n - 1));
          setEntries((prev) => [
            { id: nextId++, ts: event.ts, agentName: event.agentName, agentId: event.agentId, kind: "run_end" as const, content: event.status, status: event.status },
            ...prev,
          ].slice(0, MAX_STORED));
          return;
        }

        const lines = event.data.split("\n").filter((l) => l.trim());
        const newEntries: LogEntry[] = lines.map((line) => ({
          id: nextId++,
          ts: event.ts,
          agentName: event.agentName,
          agentId: event.agentId,
          kind: (line.startsWith("▶") ? "tool" : "text") as LogEntryKind,
          content: line,
        })).reverse();

        setEntries((prev) => [...newEntries, ...prev].slice(0, MAX_STORED));
      };

      es.onerror = () => {
        es?.close();
        es = null;
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, 5000);
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, []);

  const clear = () => {
    setEntries([]);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  };

  const clearAgent = (agentId: string) => {
    setEntries((prev) => {
      const filtered = prev.filter((e) => e.agentId !== agentId);
      saveToStorage(filtered);
      return filtered;
    });
  };

  return (
    <LogStreamCtx.Provider value={{ entries, activeRuns, clear, clearAgent }}>
      {children}
    </LogStreamCtx.Provider>
  );
}

export function useLogStream() {
  return useContext(LogStreamCtx);
}

export const AGENT_COLORS = [
  "text-blue-400",
  "text-purple-400",
  "text-emerald-400",
  "text-orange-400",
  "text-pink-400",
  "text-cyan-400",
  "text-yellow-400",
  "text-rose-400",
];

const agentColorCache = new Map<string, string>();
let colorIndex = 0;

export function agentColor(agentId: string) {
  if (!agentColorCache.has(agentId)) {
    agentColorCache.set(agentId, AGENT_COLORS[colorIndex % AGENT_COLORS.length]);
    colorIndex++;
  }
  return agentColorCache.get(agentId)!;
}

export function formatTime(ts: number) {
  return new Date(ts).toTimeString().slice(0, 8);
}
