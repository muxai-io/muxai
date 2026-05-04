"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/utils";
import type { HeartbeatRun } from "@/lib/types";

export function ReExamineButton({
  parentRunId,
  mode = "navigate",
  running = false,
}: {
  parentRunId: string;
  // "navigate" jumps to the new run's detail page (default).
  // "stay" stays on the current page and triggers a server refresh so
  // the new run appears in the surrounding list when it completes.
  mode?: "navigate" | "stay";
  // Externally-known "a re-examination on this parent is already in flight"
  // signal (e.g. a child run with status running/queued). Disables the button
  // even after the local POST completes, so the user can't double-fire.
  running?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Refresh interval handle — once a re-examination is in flight we poll the
  // server every few seconds so the surrounding list (and the `running` prop)
  // pick up the run's completion without manual page reload.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const disabled = busy || running;

  // Stop polling once the parent confirms the run is no longer running.
  useEffect(() => {
    if (!running && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [running]);

  // Once `running` becomes true (the new child has reached the list), we can
  // safely drop local busy — the `disabled` derivation will keep the button
  // disabled via the `running` prop until the run finishes.
  useEffect(() => {
    if (busy && running) setBusy(false);
  }, [busy, running]);

  // Cleanup any in-flight poller on unmount.
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      const run = await apiFetch<HeartbeatRun>(`/api/runs/${parentRunId}/re-examine`, { method: "POST" });
      if (mode === "stay") {
        // Refresh now to pick up the new in-flight run, then poll until the
        // child completes so the surrounding UI stays in sync.
        router.refresh();
        if (!pollRef.current) {
          pollRef.current = setInterval(() => router.refresh(), 4000);
        }
        // Safety net: if `running` never flips on (e.g. the run finished
        // before our refresh saw it), drop busy after a short window so the
        // button doesn't stay stuck.
        setTimeout(() => setBusy(false), 8000);
      } else {
        router.push(`/agents/${run.agentId}/runs/${run.id}`);
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to start re-examination");
      setBusy(false);
    }
  }

  const label = busy ? "Starting…" : running ? "Running…" : "Re-examine";

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="ghost" onClick={onClick} disabled={disabled} className="h-7 gap-1 text-xs">
        <RefreshCw className={`h-3.5 w-3.5 ${busy || running ? "animate-spin" : ""}`} />
        {label}
      </Button>
      {error && <span className="text-[11px] text-destructive font-mono">{error}</span>}
    </div>
  );
}
