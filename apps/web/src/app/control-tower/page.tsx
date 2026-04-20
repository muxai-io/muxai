import Link from "next/link";
import { Radar, MessageSquare, Send, MessageCircle, Phone, Settings2 } from "lucide-react";
import { apiFetch } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AgentStatusBadge } from "@/components/agent-status-badge";
import { SetupButton } from "./setup-button";

interface ControlTowerAgent {
  id: string;
  name: string;
  role: string;
  title: string | null;
  status: "idle" | "running" | "paused" | "error" | "terminated";
  capabilities: string | null;
  adapterConfig: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface ControlTowerResponse {
  agent: ControlTowerAgent | null;
  messageCount: number;
}

async function getControlTower(): Promise<ControlTowerResponse> {
  try {
    return await apiFetch<ControlTowerResponse>("/api/control-tower");
  } catch {
    return { agent: null, messageCount: 0 };
  }
}

export default async function ControlTowerPage() {
  const { agent, messageCount } = await getControlTower();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 text-red-400 ring-1 ring-red-500/20">
          <Radar className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-xl font-semibold leading-none">Control Tower</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Singleton admin agent · talks to every other agent on your behalf.
          </p>
        </div>
      </div>

      {!agent ? <EmptyState /> : <LoadedState agent={agent} messageCount={messageCount} />}
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center text-center py-14 space-y-5">
        <div className="h-14 w-14 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center ring-1 ring-red-500/20">
          <Radar className="h-6 w-6" />
        </div>
        <div className="space-y-1.5 max-w-md">
          <h2 className="text-lg font-semibold">No Control Tower yet</h2>
          <p className="text-sm text-muted-foreground">
            One admin agent per muxAI deployment. Once set up, you talk to it in chat — and
            later, through external gateways like Telegram and Discord. It can list every
            agent, invoke runs, and report results back to you.
          </p>
        </div>
        <SetupButton />
      </CardContent>
    </Card>
  );
}

function LoadedState({ agent, messageCount }: { agent: ControlTowerAgent; messageCount: number }) {
  const model = String((agent.adapterConfig as Record<string, unknown>)?.model ?? "—");

  return (
    <div className="space-y-6">
      {/* Admin card */}
      <Card className="ring-1 ring-red-500/20">
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base">{agent.name}</CardTitle>
            <AgentStatusBadge status={agent.status} />
          </div>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link href={`/agents/${agent.id}/edit`}>
                <Settings2 className="h-4 w-4" />
                Configure
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link href={`/chat?agent=${agent.id}`}>
                <MessageSquare className="h-4 w-4" />
                Open chat
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <Field label="Role" value={agent.role} />
          <Field label="Model" value={model} />
          <Field label="Messages" value={String(messageCount)} />
          <Field label="Created" value={new Date(agent.createdAt).toLocaleDateString()} />
        </CardContent>
      </Card>

      {/* Gateways */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-semibold">Gateways</h2>
            <p className="text-xs text-muted-foreground">
              External channels for talking to your Control Tower. Coming soon.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <GatewayTile icon={Send} label="Telegram" description="Bot webhook — talk to your agents from your phone." />
          <GatewayTile icon={MessageCircle} label="Discord" description="Bot in your server — ping an agent from any channel." />
          <GatewayTile icon={Phone} label="WhatsApp" description="Business API — same agent, over SMS-style chat." />
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium truncate">{value}</span>
    </div>
  );
}

function GatewayTile({
  icon: Icon,
  label,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
}) {
  return (
    <Card className="opacity-60 cursor-not-allowed">
      <CardContent className="py-5 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">{label}</span>
          </div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">Soon</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
      </CardContent>
    </Card>
  );
}
