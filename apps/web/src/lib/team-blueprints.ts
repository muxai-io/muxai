import { AGENT_TEMPLATES, type AgentTemplate } from "./agent-templates";

export interface TeamBlueprintMember {
  templateId: string;
  role: "lead" | "reporter";
}

export interface TeamBlueprint {
  id: string;
  label: string;
  description: string;
  members: TeamBlueprintMember[];
}

export function getTemplate(id: string): AgentTemplate | undefined {
  return AGENT_TEMPLATES.find((t) => t.id === id);
}

export const TEAM_BLUEPRINTS: TeamBlueprint[] = [
  {
    id: "trade-desk",
    label: "Trade Desk",
    description: "Full crypto analysis team — lead orchestrator with news, technical, and data analysts.",
    members: [
      { templateId: "team-lead", role: "lead" },
      { templateId: "news-analyst", role: "reporter" },
      { templateId: "technical-analyst", role: "reporter" },
      { templateId: "data-analyst", role: "reporter" },
    ],
  },
];
