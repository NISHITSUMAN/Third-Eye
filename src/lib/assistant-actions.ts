import { NISAR_COVERAGE_PRODUCT_CODES } from "./sar-registry";
import { INTELLIGENCE_WORKFLOWS, isIntelligenceWorkflowId, type IntelligenceWorkflowId } from "./intelligence-workflows";

export type AssistantAction =
  | { type: "fly_to"; lat: number; lng: number; altitude?: number }
  | { type: "set_layer"; layer: string; enabled: boolean }
  | { type: "search_location"; locationQuery: string }
  | { type: "get_weather_context"; locationQuery?: string }
  | { type: "get_climate_context"; locationQuery?: string; locationQueries?: string[] }
  | {
      type: "map_ranked_places";
      places: Array<{ name: string; rank: number; rationale: string; evidence: string[] }>;
    }
  | { type: "select_result"; recordId: string }
  | { type: "search_nisar"; region?: "India" | "Kashmir" | "Ladakh" | "Global"; locationQuery?: string; productCodes?: string[] }
  | { type: "search_intelligence"; workflowId: IntelligenceWorkflowId; locationQuery?: string; scope?: "global" }
  | { type: "process_selected_sentinel2_ndvi" }
  | {
      type: "run_nisar_gcov_change";
      beforeRecordId: string;
      afterRecordId: string;
      frequency: "frequencyA" | "frequencyB";
      polarizationTerm: "HHHH" | "HVHV" | "VVVV" | "VHVH" | "RHRH" | "RVRV";
    }
  | { type: "get_nisar_investigation_status" }
  | { type: "switch_earth_view"; view: "2d" | "3d" }
  | { type: "set_time_range"; start: string; end: string }
  | { type: "navigate"; route: "/" | "/data" | "/analyze" | "/observations" | "/events" | "/discover" }
  | { type: "refresh_live" };

export const ASSISTANT_PRODUCTS: string[] = [...NISAR_COVERAGE_PRODUCT_CODES];
export const ASSISTANT_WORKFLOWS: IntelligenceWorkflowId[] = INTELLIGENCE_WORKFLOWS.map((workflow) => workflow.id);
export const ASSISTANT_LAYERS = ["nisar-coverage", ...ASSISTANT_PRODUCTS.map(code => `prod-${code}`), "live-usgs", "live-eonet"];
export const ASSISTANT_ROUTES = ["/", "/data", "/analyze", "/observations", "/events", "/discover"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function validLocationQuery(value: unknown, userMessage: string, allowAgentSelected = false): value is string {
  if (typeof value !== "string") return false;
  const query = value.trim();
  return query.length >= 2 &&
    query.length <= 120 &&
    ![...query].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) &&
    (allowAgentSelected || userMessage.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
}

function validPlainText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= maxLength &&
    ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

export function validateAssistantAction(value: unknown, userMessage: string): AssistantAction | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "fly_to") {
    const lat = Number(value.lat);
    const lng = Number(value.lng);
    const altitude = value.altitude === undefined ? 0.4 : Number(value.altitude);
    const coordinatePairs = [...userMessage.matchAll(/(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)/g)];
    const explicitlyProvided = coordinatePairs.some(pair => Number(pair[1]) === lat && Number(pair[2]) === lng);
    return explicitlyProvided && Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(altitude)
      && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && altitude >= 0.002 && altitude <= 5
      ? { type: "fly_to", lat, lng, altitude }
      : null;
  }
  if (value.type === "set_layer" && typeof value.layer === "string" && ASSISTANT_LAYERS.includes(value.layer) && typeof value.enabled === "boolean") {
    return { type: "set_layer", layer: value.layer, enabled: value.enabled };
  }
  if (value.type === "search_location") {
    return validLocationQuery(value.locationQuery, userMessage)
      ? { type: "search_location", locationQuery: value.locationQuery.trim() }
      : null;
  }
  if (value.type === "get_weather_context") {
    if (value.locationQuery !== undefined && !validLocationQuery(value.locationQuery, userMessage)) return null;
    return {
      type: "get_weather_context",
      ...(typeof value.locationQuery === "string" ? { locationQuery: value.locationQuery.trim() } : {}),
    };
  }
  if (value.type === "get_climate_context") {
    if (value.locationQuery !== undefined && value.locationQueries !== undefined) return null;
    if (value.locationQuery !== undefined) {
      return validLocationQuery(value.locationQuery, userMessage, true)
        ? { type: "get_climate_context", locationQuery: value.locationQuery.trim() }
        : null;
    }
    if (value.locationQueries !== undefined) {
      if (!Array.isArray(value.locationQueries) || value.locationQueries.length < 2 || value.locationQueries.length > 5) return null;
      const locationQueries = value.locationQueries.map(query => typeof query === "string" ? query.trim() : "");
      const uniqueQueries = new Set(locationQueries.map(query => query.toLocaleLowerCase()));
      return locationQueries.every(query => validLocationQuery(query, userMessage, true)) && uniqueQueries.size === locationQueries.length
        ? { type: "get_climate_context", locationQueries }
        : null;
    }
    return { type: "get_climate_context" };
  }
  if (value.type === "map_ranked_places" && Array.isArray(value.places) && value.places.length >= 1 && value.places.length <= 8) {
    const places = value.places.flatMap((item): Array<{ name: string; rank: number; rationale: string; evidence: string[] }> => {
      if (!isRecord(item) ||
          !validPlainText(item.name, 120) ||
          !Number.isInteger(item.rank) ||
          Number(item.rank) < 1 ||
          Number(item.rank) > 8 ||
          !validPlainText(item.rationale, 320) ||
          !Array.isArray(item.evidence) ||
          item.evidence.length > 4 ||
          !item.evidence.every(evidence => validPlainText(evidence, 160))) return [];
      return [{
        name: item.name.trim(),
        rank: Number(item.rank),
        rationale: item.rationale.trim(),
        evidence: item.evidence.map(evidence => evidence.trim()),
      }];
    });
    const ranks = new Set(places.map(place => place.rank));
    const names = new Set(places.map(place => place.name.toLocaleLowerCase()));
    return places.length === value.places.length && ranks.size === places.length && names.size === places.length
      ? { type: "map_ranked_places", places: [...places].sort((a, b) => a.rank - b.rank) }
      : null;
  }
  if (value.type === "select_result") {
    const recordId = typeof value.recordId === "string" ? value.recordId.trim() : "";
    return recordId.length >= 1 && recordId.length <= 200 &&
      ![...recordId].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) &&
      /\b(?:select|focus|open|show|zoom|inspect|view)\b/i.test(userMessage)
      ? { type: "select_result", recordId }
      : null;
  }
  if (value.type === "search_nisar") {
    const region = value.region;
    if (region !== undefined && (typeof region !== "string" || !["India", "Kashmir", "Ladakh", "Global"].includes(region))) {
      return null;
    }
    if (region === "India" && !/\bindia\b/i.test(userMessage)) return null;
    if (region === "Kashmir" && !/\b(?:kashmir|jammu)\b/i.test(userMessage)) return null;
    if (region === "Ladakh" && !/\b(?:ladakh|leh)\b/i.test(userMessage)) return null;
    if (region === "Global" && !/\b(?:global|worldwide|world)\b/i.test(userMessage)) return null;
    const locationQuery = value.locationQuery;
    if (locationQuery !== undefined && !validLocationQuery(locationQuery, userMessage)) return null;
    if (locationQuery !== undefined && region !== undefined) return null;
    const codes = Array.isArray(value.productCodes)
      ? [...new Set(value.productCodes.filter((item): item is string => typeof item === "string").map(item => item.toUpperCase()))]
        .filter(code => ASSISTANT_PRODUCTS.includes(code))
        .slice(0, 5)
      : [];
    return {
      type: "search_nisar",
      ...(region ? { region: region as "India" | "Kashmir" | "Ladakh" | "Global" } : {}),
      ...(typeof locationQuery === "string" ? { locationQuery: locationQuery.trim() } : {}),
      ...(codes.length ? { productCodes: codes } : {}),
    };
  }
  if (value.type === "search_intelligence" && isIntelligenceWorkflowId(value.workflowId)) {
    const locationQuery = value.locationQuery;
    if (locationQuery !== undefined && !validLocationQuery(locationQuery, userMessage)) return null;
    if (value.scope !== undefined && (value.scope !== "global" || !/\b(?:global|worldwide|world)\b/i.test(userMessage))) return null;
    if (locationQuery !== undefined && value.scope === "global") return null;
    return {
      type: "search_intelligence",
      workflowId: value.workflowId,
      ...(typeof locationQuery === "string" ? { locationQuery: locationQuery.trim() } : {}),
      ...(value.scope === "global" ? { scope: "global" } : {}),
    };
  }
  if (value.type === "run_nisar_gcov_change") {
    const beforeRecordId = typeof value.beforeRecordId === "string" ? value.beforeRecordId.trim() : "";
    const afterRecordId = typeof value.afterRecordId === "string" ? value.afterRecordId.trim() : "";
    const frequency = value.frequency;
    const polarizationTerm = value.polarizationTerm;
    const explicitRequest = /\b(?:run|start|process|calculate|compute|compare|analy[sz]e|generate)\b/i.test(userMessage)
      && /\bnisar\b/i.test(userMessage)
      && /\b(?:gcov|backscatter|radar change|acquisitions?)\b/i.test(userMessage);
    const validId = (id: string) => id.length >= 3 && id.length <= 200
      && ![...id].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
    return explicitRequest && validId(beforeRecordId) && validId(afterRecordId)
      && beforeRecordId !== afterRecordId
      && (frequency === "frequencyA" || frequency === "frequencyB")
      && ["HHHH", "HVHV", "VVVV", "VHVH", "RHRH", "RVRV"].includes(String(polarizationTerm))
      ? {
          type: "run_nisar_gcov_change",
          beforeRecordId,
          afterRecordId,
          frequency,
          polarizationTerm: polarizationTerm as "HHHH" | "HVHV" | "VVVV" | "VHVH" | "RHRH" | "RVRV",
        }
      : null;
  }
  if (value.type === "get_nisar_investigation_status") {
    return /\b(?:status|progress|update|completed|finished|result)\b/i.test(userMessage)
      && /\b(?:nisar|gcov|backscatter|radar investigation|guest investigation|job)\b/i.test(userMessage)
      ? { type: "get_nisar_investigation_status" }
      : null;
  }
  if (value.type === "process_selected_sentinel2_ndvi") {
    const asksToProcess = /\b(?:process|calculate|compute|run|analy[sz]e|generate|make|create)\b/i.test(userMessage);
    const asksForNDVI = /\b(?:ndvi|normalized difference vegetation index|vegetation index)\b/i.test(userMessage);
    return asksToProcess && asksForNDVI ? { type: "process_selected_sentinel2_ndvi" } : null;
  }
  if (value.type === "switch_earth_view" && (value.view === "2d" || value.view === "3d")) {
    return { type: "switch_earth_view", view: value.view };
  }
  if (value.type === "set_time_range" && typeof value.start === "string" && typeof value.end === "string") {
    return isDate(value.start) && isDate(value.end) && value.start <= value.end
      ? { type: "set_time_range", start: value.start, end: value.end }
      : null;
  }
  if (value.type === "navigate" && typeof value.route === "string" && ASSISTANT_ROUTES.includes(value.route as (typeof ASSISTANT_ROUTES)[number])) {
    return { type: "navigate", route: value.route as (typeof ASSISTANT_ROUTES)[number] };
  }
  if (value.type === "refresh_live") return { type: "refresh_live" };
  return null;
}
