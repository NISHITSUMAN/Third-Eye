import type { AssistantAction } from "./assistant-actions";
import { redactSensitiveText } from "./sensitive-text";

export type EvidenceLevel =
  | "live_measurement"
  | "retrieved_dataset"
  | "derived_analysis"
  | "trusted_reference"
  | "general_knowledge"
  | "insufficient_evidence";

export interface AssistantExecutionResult {
  tool: string;
  status: "completed" | "partial" | "failed";
  evidenceLevel: EvidenceLevel;
  source: string;
  summary: string;
}

export function formatAssistantExecutionSummary(result: AssistantExecutionResult): string {
  if (result.tool !== "get_climate_context" || !result.summary.trimStart().startsWith("{")) {
    return result.summary;
  }
  try {
    const parsed: unknown = JSON.parse(result.summary);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "Historical environmental context was returned, but could not be summarized.";
    }
    const payload = parsed as Record<string, unknown>;
    const profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
    const names = profiles.flatMap(profile =>
      profile && typeof profile === "object" && !Array.isArray(profile) &&
      "location" in profile && typeof profile.location === "string" ? [profile.location] : [],
    );
    const errors = Array.isArray(payload.candidateErrors)
      ? payload.candidateErrors.filter((error): error is string => typeof error === "string")
        .slice(0, 3).map(error => error.slice(0, 160))
      : [];
    const available = names.length
      ? `Historical environmental profiles were retrieved for ${names.join(", ")}.`
      : "No complete historical environmental profiles were retrieved.";
    const failures = errors.length
      ? ` Some candidate profiles could not be completed: ${errors.join("; ")}.`
      : "";
    const partial = payload.status === "partial" && !errors.length
      ? " Some environmental fields were incomplete; see the listed limitations."
      : "";
    return `${available}${failures}${partial}`;
  } catch {
    return "Historical environmental context was returned, but could not be summarized.";
  }
}

function inferredStatus(action: AssistantAction, summary: string): AssistantExecutionResult["status"] {
  if (action.type === "search_nisar" && /NASA CMR search failed/i.test(summary)) return "failed";
  if (action.type === "process_selected_sentinel2_ndvi") {
    if (/\bis (?:queued|processing)\b/i.test(summary)) return "partial";
    if (/\bis (?:failed|cancelled)\b/i.test(summary)) return "failed";
  }
  if (action.type === "search_intelligence") {
    const failedProviders = (summary.match(/(?:NASA CMR|Planetary Computer):[^.]*?(?:failed|error|unavailable)/gi) ?? []).length;
    if (failedProviders >= 2) return "failed";
    if (failedProviders === 1) return "partial";
  }
  if (action.type === "refresh_live") {
    const failedProviders = (summary.match(/(?:USGS|NASA EONET):\s*error/gi) ?? []).length;
    if (failedProviders >= 2) return "failed";
    if (failedProviders === 1) return "partial";
  }
  if (action.type === "get_weather_context" &&
      /not configured|could not be retrieved|returned no weather measurements/i.test(summary)) return "failed";
  if (action.type === "get_climate_context" && /"status"\s*:\s*"partial"/i.test(summary)) return "partial";
  if (action.type === "get_climate_context" &&
      /could not be retrieved|unavailable|no complete monthly summaries/i.test(summary)) return "failed";
  if (action.type === "map_ranked_places" && /candidate place\(s\) could not be geocoded and were omitted/i.test(summary)) return "partial";
  return "completed";
}

function actionEvidence(action: AssistantAction, status: AssistantExecutionResult["status"], summary: string): Pick<AssistantExecutionResult, "evidenceLevel" | "source"> {
  if (status === "failed") {
    return { evidenceLevel: "insufficient_evidence", source: "Tool execution" };
  }
  switch (action.type) {
    case "search_location":
      return { evidenceLevel: "trusted_reference", source: "Geocoding provider" };
    case "get_weather_context":
      return /Meteomatics weather context.*:\s*[^.]/i.test(summary) &&
        !/not configured|could not be retrieved|returned no weather measurements/i.test(summary)
        ? { evidenceLevel: "live_measurement", source: "Meteomatics" }
        : { evidenceLevel: "insufficient_evidence", source: "Meteomatics" };
    case "get_climate_context":
      return { evidenceLevel: "retrieved_dataset", source: "Open-Meteo ERA5-Land historical reanalysis and elevation" };
    case "map_ranked_places":
      return { evidenceLevel: "general_knowledge", source: "Third Eye AI screening with geocoder-verified place references" };
    case "search_nisar":
      return { evidenceLevel: "retrieved_dataset", source: "NASA CMR / NISAR catalog" };
    case "search_intelligence":
      return { evidenceLevel: "retrieved_dataset", source: "NASA CMR and Microsoft Planetary Computer STAC" };
    case "process_selected_sentinel2_ndvi":
      return { evidenceLevel: "insufficient_evidence", source: "Sentinel-2 processing job status" };
    case "refresh_live":
      return { evidenceLevel: "retrieved_dataset", source: "USGS and NASA EONET source-reported event feeds" };
    case "select_result":
      return { evidenceLevel: "retrieved_dataset", source: "Loaded application record" };
    default:
      return { evidenceLevel: "insufficient_evidence", source: "Application action" };
  }
}

export function createAssistantExecutionResult(
  action: AssistantAction,
  summary: string,
  requestedStatus: AssistantExecutionResult["status"] = "completed",
): AssistantExecutionResult {
  const status = requestedStatus === "failed" ? requestedStatus : inferredStatus(action, summary);
  return {
    tool: action.type,
    status,
    ...actionEvidence(action, status, summary),
    summary: redactSensitiveText(summary).slice(0, 3_500),
  };
}

export function sanitizeAssistantExecutionResult(value: unknown): AssistantExecutionResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  const clientEvidenceLevels: EvidenceLevel[] = [
    "live_measurement",
    "retrieved_dataset",
    "trusted_reference",
    "general_knowledge",
    "insufficient_evidence",
  ];
  if (typeof result.tool !== "string" ||
      typeof result.source !== "string" ||
      typeof result.summary !== "string" ||
      (result.status !== "completed" && result.status !== "partial" && result.status !== "failed") ||
      typeof result.evidenceLevel !== "string" ||
      !clientEvidenceLevels.includes(result.evidenceLevel as EvidenceLevel)) return null;
  return {
    tool: redactSensitiveText(result.tool).slice(0, 80),
    status: result.status,
    evidenceLevel: result.evidenceLevel as EvidenceLevel,
    source: redactSensitiveText(result.source).slice(0, 120),
    summary: redactSensitiveText(result.summary.replace(/\p{Cc}/gu, " ").trim()).slice(0, 3_500),
  };
}
