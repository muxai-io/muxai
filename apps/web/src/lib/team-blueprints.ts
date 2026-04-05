import { AGENT_TEMPLATES, type AgentTemplate } from "./agent-templates";

export interface TeamBlueprintMember {
  templateId: string;
  role: "lead" | "reporter";
}

export interface TeamBlueprint {
  id: string;
  label: string;
  description: string;
  image?: string;
  members: TeamBlueprintMember[];
}

export function getTemplate(id: string): AgentTemplate | undefined {
  return AGENT_TEMPLATES.find((t) => t.id === id);
}

export const TEAM_BLUEPRINTS: TeamBlueprint[] = [
  {
    id: "trade-desk",
    label: "Trade Desk",
    description: "Crypto analysis team that synthesizes OHLCV indicators, funding rates, open interest, news sentiment, and chart analysis into a structured trade decision.",
    image: "/trading_desk_team.jpg",
    members: [
      { templateId: "team-lead", role: "lead" },
      { templateId: "news-analyst", role: "reporter" },
      { templateId: "technical-analyst", role: "reporter" },
      { templateId: "data-analyst", role: "reporter" },
    ],
  },
];
