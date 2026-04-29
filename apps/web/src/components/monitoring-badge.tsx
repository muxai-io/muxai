import type { HeartbeatRun } from "@/lib/types";

interface Props {
  run: Pick<HeartbeatRun, "outcome" | "outcomeFields" | "resolutionStatus" | "resolutionMeta" | "finishedAt">;
  compact?: boolean;
}

export function MonitoringBadge({ run, compact }: Props) {
  const status = run.resolutionStatus;
  const outcome = run.outcome;
  const fields = (run.outcomeFields ?? {}) as Record<string, unknown>;
  const meta = (run.resolutionMeta ?? {}) as Record<string, unknown>;
  const r = typeof fields.r_multiple === "number" ? fields.r_multiple : null;

  if (!status && !outcome) return null;

  if (status === "pending") {
    return <Pill dot="bg-slate-400" label="watching for entry" tone="border-slate-500/30 bg-slate-500/5 text-slate-300" />;
  }

  if (status === "active") {
    const entered = typeof meta.enteredAt === "number" ? relative(meta.enteredAt) : null;
    return (
      <Pill
        dot="bg-amber-400 animate-pulse"
        label={entered ? `live · entered ${entered}` : "live · awaiting fill"}
        tone="border-amber-500/40 bg-amber-500/10 text-amber-300"
      />
    );
  }

  if (status === "expired" || (status === "resolved" && outcome === "NA")) {
    return <Pill dot="bg-slate-400" label={`expired · ${outcome ?? "NA"}`} tone="border-slate-500/30 bg-slate-500/5 text-slate-300" />;
  }

  if (status === "resolved" && outcome) {
    const reason = typeof meta.reason === "string" ? meta.reason : null;
    const reasonLabel = reason === "tp_hit" ? "TP hit" : reason === "sl_hit" ? "SL hit" : reason === "same_bar_collision" ? "same-bar collision" : null;
    const tone = outcome === "Win"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
      : outcome === "Loss"
        ? "border-red-500/40 bg-red-500/10 text-red-300"
        : "border-slate-500/30 bg-slate-500/5 text-slate-300";
    const dot = outcome === "Win" ? "bg-emerald-400" : outcome === "Loss" ? "bg-red-400" : "bg-slate-400";
    const rText = r !== null ? `${r >= 0 ? "+" : ""}${r}R` : null;
    const text = compact
      ? [outcome, rText].filter(Boolean).join(" · ")
      : [outcome, rText, reasonLabel].filter(Boolean).join(" · ");
    return <Pill dot={dot} label={text} tone={tone} />;
  }

  // User-marked outcome with no resolution path (older runs, manual marking)
  if (outcome) {
    const tone = outcome.toLowerCase() === "win"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
      : outcome.toLowerCase() === "loss"
        ? "border-red-500/40 bg-red-500/10 text-red-300"
        : "border-slate-500/30 bg-slate-500/5 text-slate-300";
    const dot = outcome.toLowerCase() === "win" ? "bg-emerald-400" : outcome.toLowerCase() === "loss" ? "bg-red-400" : "bg-slate-400";
    return <Pill dot={dot} label={outcome} tone={tone} />;
  }

  return null;
}

function Pill({ dot, label, tone }: { dot: string; label: string; tone: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function relative(ms: number): string {
  const dt = Date.now() - ms;
  if (dt < 60_000) return "just now";
  const m = Math.floor(dt / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
