"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bot, ChevronDown, Check, Loader2, StickyNote, ExternalLink, UserMinus } from "lucide-react";
import { apiFetch, cn } from "@/lib/utils";
import { AgentStatusBadge } from "@/components/agent-status-badge";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import type { AgentStatus } from "@/lib/types";

interface Reporter {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  adapterConfig: Record<string, unknown>;
}

function ReporterCard({ reporter, onSave, onRemove }: {
  reporter: Reporter;
  onSave: (reporter: Reporter, prompt: string) => Promise<void>;
  onRemove: (reporter: Reporter) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(String(reporter.adapterConfig.defaultPrompt ?? ""));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(reporter, prompt);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setRemoving(true);
    try {
      await onRemove(reporter);
      setShowRemoveDialog(false);
    } finally {
      setRemoving(false);
    }
  }

  const hasInstructions = !!reporter.adapterConfig.defaultPrompt;

  return (
    <>
    <Dialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove from team</DialogTitle>
          <DialogDescription>
            Remove <strong>{reporter.name}</strong> from this team? They will no longer be invoked as a reporter. The agent itself is not deleted.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowRemoveDialog(false)} disabled={removing}>Cancel</Button>
          <Button variant="destructive" onClick={handleRemove} disabled={removing}>
            {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-500/10 text-indigo-400 shrink-0">
          <Bot className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{reporter.name}</span>
            <AgentStatusBadge status={reporter.status} />
          </div>
          <p className="text-xs text-muted-foreground capitalize">{reporter.role}</p>
        </div>
        <div className="flex items-center gap-1 ml-auto shrink-0">
          <Button asChild size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
            <Link href={`/agents/${reporter.id}`}><ExternalLink className="h-3.5 w-3.5" /></Link>
          </Button>
          <Button
            size="sm" variant="ghost"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            onClick={() => setShowRemoveDialog(true)}
            disabled={removing}
          >
            <UserMinus className="h-3.5 w-3.5" />
          </Button>
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors pl-1"
          >
            <StickyNote className={cn("h-3.5 w-3.5", hasInstructions && "text-indigo-400")} />
            Instructions
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          </button>
        </div>
      </div>

      {/* Collapsible instructions */}
      {open && (
        <div className="border-t border-border px-4 py-3 space-y-3 bg-muted/20">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Default instructions for this reporter…"
            className="text-sm min-h-[90px] resize-y bg-background"
          />
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : saved ? (
                <><Check className="h-3 w-3 text-emerald-400" /> Saved</>
              ) : (
                "Save"
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
    </>
  );
}

export function TeamPanel({ reporters }: { reporters: Reporter[] }) {
  const router = useRouter();

  async function save(reporter: Reporter, prompt: string) {
    await apiFetch(`/api/agents/${reporter.id}`, {
      method: "PATCH",
      body: JSON.stringify({ adapterConfig: { ...reporter.adapterConfig, defaultPrompt: prompt } }),
    });
    router.refresh();
  }

  async function remove(reporter: Reporter) {
    await apiFetch(`/api/agents/${reporter.id}`, {
      method: "PATCH",
      body: JSON.stringify({ reportsToId: null }),
    });
    router.refresh();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">Team</h2>
        <span className="text-sm text-muted-foreground">{reporters.length} reporter{reporters.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="space-y-2">
        {reporters.map((reporter) => (
          <ReporterCard key={reporter.id} reporter={reporter} onSave={save} onRemove={remove} />
        ))}
      </div>
    </div>
  );
}
