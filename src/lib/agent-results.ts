import type { AssistantExecutionResult } from "./assistant-evidence";
import type { Geometry } from "geojson";

export interface AgentMapFinding {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  geometry?: Geometry;
  rank: number;
  rationale: string;
  evidence: string[];
  confidence: "screening";
  locationSource: string;
}

export interface AgentInvestigation {
  goal: string;
  summary: string;
  answer: string;
  findings: AgentMapFinding[];
  mapActions: Array<{ type: "map_ranked_places"; findingIds: string[] }>;
  evidence: AssistantExecutionResult[];
  sources: string[];
  limitations: string[];
  confidence: "screening" | "not-assessed";
  createdAt: string;
}
