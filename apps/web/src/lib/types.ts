export type AgentStatus = "idle" | "running" | "paused" | "error" | "terminated";
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out";

export interface Agent {
  id: string;
  name: string;
  role: string;
  title: string | null;
  status: AgentStatus;
  capabilities: string | null;
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  runtimeConfig: Record<string, unknown>;
  reportsToId: string | null;
  reportsTo: { id: string; name: string; role: string } | null;
  reports: { id: string; name: string; role: string; status: AgentStatus; adapterConfig: Record<string, unknown> }[];
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  _count?: { runs: number };
}

export interface HeartbeatRun {
  id: string;
  agentId: string;
  agent?: { id: string; name: string; role: string; adapterConfig?: Record<string, unknown> };
  status: RunStatus;
  invocationSource: string;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  errorMsg: string | null;
  logs: string | null;
  resultJson: Record<string, unknown> | null;
  outcome: string | null;
  outcomeFields: Record<string, unknown> | null;
  outcomeAt: string | null;
  resolutionStatus: "pending" | "active" | "resolved" | "expired" | null;
  resolutionCheckedAt: string | null;
  resolutionMeta: Record<string, unknown> | null;
  parentRunId: string | null;
  createdAt: string;
}
