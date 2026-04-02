export const SKILL_PLACEHOLDER = `---
name:
description: >
  Routing description — tells the lead agent WHEN to invoke this skill.
  Decision logic, not marketing copy.
---

# Agent Instructions

Your instructions here...`;

export interface AgentTemplate {
  id: string;
  label: string;
  description: string;
  form: {
    name: string;
    role: string;
    title: string;
    capabilities: string;
    model: string;
    cwd: string;
    allowedTools: string;
    maxTurnsPerRun: string;
    customCron: string;
  };
  mcpPreset: string;
  schedulePreset: string;
  useChrome?: boolean;
  persistLogs?: boolean;
  resultCard?: { type: string; mapping: Record<string, string> };
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "team-lead",
    label: "Team Lead",
    description: "Lead orchestrator — gathers findings from all team members and outputs a final decision.",
    mcpPreset: "builtin",
    schedulePreset: "disabled",
    resultCard: { type: "research-summary", mapping: {} },
    persistLogs: true,
    form: {
      name: "Team Lead",
      role: "ceo",
      title: "Team Lead",
      capabilities: "You are an expert Team Lead skilled at gathering team feedback, facilitating constructive discussions, and making concise, well-reasoned decisions. Always stay professional, balanced, and solution-oriented. Be concise and decisive, keeping in mind your teams feedback.",
      model: "claude-opus-4-6",
      cwd: "",
      allowedTools: "",
      maxTurnsPerRun: "30",
      customCron: "",
    },
  },
  {
    id: "news-analyst",
    label: "News Analyst",
    description: "Fetches crypto news from RSS feeds and CMC, assesses sentiment and impact.",
    mcpPreset: "builtin",
    schedulePreset: "disabled",
    form: {
      name: "News Analyst",
      role: "news-analyst",
      title: "Crypto News Analyst",
      capabilities: "Cryptocurrency news gathering, sentiment analysis, impact assessment",
      model: "claude-sonnet-4-6",
      cwd: "",
      allowedTools: "",
      maxTurnsPerRun: "10",
      customCron: "",
    },
  },
  {
    id: "technical-analyst",
    label: "Technical Analyst",
    description: "Analyzes charts and CMC technical data to identify directional bias.",
    mcpPreset: "builtin",
    schedulePreset: "disabled",
    form: {
      name: "Technical Analyst",
      role: "technical-analyst",
      title: "Crypto Technical Analyst",
      capabilities: "Chart pattern recognition, technical indicator analysis, support/resistance identification",
      model: "claude-sonnet-4-6",
      cwd: "",
      allowedTools: "",
      maxTurnsPerRun: "10",
      customCron: "",
    },
  },
  {
    id: "data-analyst",
    label: "Data Analyst",
    description: "Analyzes open interest, funding rates, and fear & greed index.",
    mcpPreset: "builtin",
    schedulePreset: "disabled",
    useChrome: true,
    form: {
      name: "Data Analyst",
      role: "analyst",
      title: "Crypto Data Analyst",
      capabilities: "Open interest analysis, funding rate interpretation, fear & greed assessment",
      model: "claude-sonnet-4-6",
      cwd: "",
      allowedTools: "",
      maxTurnsPerRun: "15",
      customCron: "",
    },
  },
];
