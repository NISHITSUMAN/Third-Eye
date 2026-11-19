import { useApp } from "./store";
import type { AIStep } from "./store";
import { makeAOI, rectangleAOI } from "./analysis";
import type { NISARGranule } from "./nasa-cmr";
import { validateAssistantAction, type AssistantAction as Action } from "./assistant-actions";
import { prepareSpokenResponse } from "./assistant-voice";
import { getIntelligenceWorkflow } from "./intelligence-workflows";
import { normalizeGeoSearchResult } from "./geocode";
import { redactSensitiveText } from "./sensitive-text";
import {
  createAssistantExecutionResult,
  formatAssistantExecutionSummary,
  type AssistantExecutionResult,
} from "./assistant-evidence";
import type { AgentMapFinding } from "./agent-results";
import { cancelGuestNISARJob, getGuestNISARStatus, readGuestNISARCapability, submitGuestNISARComparison } from "./guest-nisar";

type KnownRegion = "India" | "Kashmir" | "Ladakh" | "Global";
const REGIONS: Record<KnownRegion, { name: string; bounds: [number, number, number, number] | null; lat: number; lng: number; altitude: number }> = {
  India: { name: "India", bounds: [68, 6, 98, 38], lat: 22.5, lng: 79, altitude: 1.05 },
  Kashmir: { name: "Kashmir region · India-aligned boundary view", bounds: [72, 31.8, 81.2, 37.8], lat: 34.4, lng: 76.2, altitude: 0.18 },
  Ladakh: { name: "Ladakh · India-aligned boundary view", bounds: [74.9, 31.9, 81, 36.5], lat: 34.4, lng: 78.1, altitude: 0.09 },
  Global: { name: "Global", bounds: null, lat: 0, lng: 0, altitude: 2.4 },
};
const uid = () => `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export function summarizeNISARSearch(result: {
  status: "idle" | "loading" | "ready" | "partial" | "error";
  error: string | null;
  granules: readonly NISARGranule[];
  hits: number;
}) {
  if (result.status === "error") {
    return `The NASA CMR search failed${result.error ? `: ${result.error}` : "."}`;
  }
  if (!result.hits) {
    return "NASA CMR returned no matching NISAR acquisition records for the selected date range and map area.";
  }
  const latest = [...result.granules]
    .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""))[0];
  const date = latest?.startDate && Number.isFinite(Date.parse(latest.startDate))
    ? `, acquired ${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(latest.startDate))}`
    : "";
  const record = latest ? ` Most recent loaded record: ${latest.granuleId}${date}.` : "";
  const partial = result.status === "partial" ? " Some catalog requests returned partial results." : "";
  return `NASA CMR reports ${result.hits} matching acquisition record(s); ${result.granules.length} granule(s) loaded.${record}${partial} These are catalog records, not processed radar measurements.`;
}
type RunCommandOptions = {
  voice?: boolean;
  signal?: AbortSignal;
  onResponse?: (text: string) => void | Promise<void>;
  onNavigate?: (route: Extract<Action, { type: "navigate" }>["route"]) => void;
};

async function waitForLiveDataRefresh(signal?: AbortSignal) {
  if (useApp.getState().liveDataStatus !== "loading") return;
  await new Promise<void>(resolve => {
    let unsubscribe = () => {};
    const finish = () => {
      clearTimeout(timer);
      unsubscribe();
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, 13_000);
    signal?.addEventListener("abort", finish, { once: true });
    unsubscribe = useApp.subscribe(state => {
      if (state.liveDataStatus !== "loading") finish();
    });
    if (signal?.aborted) finish();
  });
}

async function waitForNISARDataRefresh() {
  if (useApp.getState().nisarStatus !== "loading") return true;
  return new Promise<boolean>(resolve => {
    let unsubscribe = () => {};
    let settled = false;
    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(completed);
    };
    const timer = setTimeout(() => finish(false), 16_000);
    unsubscribe = useApp.subscribe(state => {
      if (state.nisarStatus !== "loading") finish(true);
    });
    if (useApp.getState().nisarStatus !== "loading") finish(true);
  });
}

async function findAssistantLocation(query: string) {
  const params = new URLSearchParams({ q: query });
  const response = await fetch(`/api/geocode/search?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The place search returned an invalid response.");
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : `Place search returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  if (!payload || typeof payload !== "object" || !("results" in payload) || !Array.isArray(payload.results)) {
    throw new Error("The place search returned no usable results.");
  }
  const result = normalizeGeoSearchResult(payload.results[0]);
  if (!result) throw new Error(`No verified place result was found for "${query}".`);
  return result;
}

async function applyAssistantLocation(query: string) {
  const result = await findAssistantLocation(query);
  const [west, south, east, north] = result.bbox;
  const aoi = result.geometry && (result.geometry.type === "Polygon" || result.geometry.type === "MultiPolygon")
    ? makeAOI({ type: "Feature", properties: {}, geometry: result.geometry }, result.displayName)
    : rectangleAOI([west, south], [east, north]);
  const app = useApp.getState();
  app.setAOI({ ...aoi, name: result.displayName });
  app.setLocationResult(result);
  app.toggleLayer("search-location", true);
  app.select(result.id);
  return result;
}

async function executeClimateContext(action: Extract<Action, { type: "get_climate_context" }>) {
  const fetchProfile = async (locationQuery?: string) => {
    let locationName: string;
    let latitude: number;
    let longitude: number;
    let areaBounds: number[] | undefined;
    if (locationQuery) {
      const location = await findAssistantLocation(locationQuery);
      locationName = location.displayName;
      latitude = location.latitude;
      longitude = location.longitude;
    } else {
      const state = useApp.getState();
      if (state.aoi) {
        locationName = state.aoi.name || "Selected area";
        latitude = state.aoi.center.lat;
        longitude = state.aoi.center.lng;
        areaBounds = state.aoi.bounds;
      } else if (state.locationResult) {
        locationName = state.locationResult.displayName;
        latitude = state.locationResult.latitude;
        longitude = state.locationResult.longitude;
      } else {
        throw new Error("There is no selected area to profile. Select an area or name a place.");
      }
    }

    const params = new URLSearchParams({ lat: String(latitude), lng: String(longitude) });
    const response = await fetch(`/api/climate/context?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`The historical climate endpoint returned an invalid response for ${locationName}.`);
    }
    if (!response.ok) {
      const message = payload && typeof payload === "object" && !Array.isArray(payload) &&
        "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `Historical climate request returned HTTP ${response.status} for ${locationName}.`;
      throw new Error(message);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error(`The historical climate endpoint returned no usable profile for ${locationName}.`);
    }
    return {
      location: locationName,
      coordinates: { latitude, longitude },
      ...(areaBounds ? { areaBounds } : {}),
      context: payload as Record<string, unknown>,
    };
  };

  const queries = action.locationQueries ?? (action.locationQuery ? [action.locationQuery] : [undefined]);
  const outcomes = await Promise.all(queries.map(async locationQuery => {
    try {
      return { profile: await fetchProfile(locationQuery), error: null };
    } catch (error) {
      return {
        profile: null,
        error: error instanceof Error ? error.message : "The climate profile could not be retrieved.",
      };
    }
  }));
  const profiles = outcomes.flatMap(outcome => outcome.profile ? [outcome.profile] : []);
  if (!profiles.length) {
    throw new Error(outcomes.find(outcome => outcome.error)?.error ?? "No climate profiles could be retrieved.");
  }

  const sources = [...new Set(profiles.flatMap(({ context }) =>
    Array.isArray(context.sources)
      ? context.sources.flatMap(source =>
          source && typeof source === "object" && !Array.isArray(source) &&
          "name" in source && typeof source.name === "string" ? [source.name] : [],
        )
      : [],
  ))];
  const limitations = [...new Set(profiles.flatMap(({ context }) =>
    Array.isArray(context.limitations)
      ? context.limitations.filter((item): item is string => typeof item === "string")
      : [],
  ))];
  const compactProfiles = profiles.map(({ location, coordinates, areaBounds, context }) => ({
    location,
    coordinates,
    ...(areaBounds ? { areaBounds } : {}),
    period: context.period,
    monthColumns: ["month", "meanTemperatureC", "meanMonthlyPrecipitationMm", "completeYears"],
    monthlySummary: Array.isArray(context.monthlySummary)
      ? context.monthlySummary.flatMap(item => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return [];
          const month = item as Record<string, unknown>;
          return Number.isInteger(month.month) &&
            typeof month.meanTemperatureC === "number" &&
            typeof month.meanMonthlyPrecipitationMm === "number" &&
            Number.isInteger(month.completeYears)
            ? [[month.month, month.meanTemperatureC, month.meanMonthlyPrecipitationMm, month.completeYears]]
            : [];
        })
      : [],
    elevation: context.elevation ?? null,
    status: context.status,
  }));
  const partial = outcomes.some(outcome => outcome.error !== null) ||
    profiles.some(({ context }) => context.status === "partial");
  return JSON.stringify({
    status: partial ? "partial" : "ready",
    profiles: compactProfiles,
    sources,
    limitations,
    candidateErrors: outcomes.flatMap(outcome => outcome.error ? [outcome.error] : []),
  });
}

async function executeRankedPlaces(
  action: Extract<Action, { type: "map_ranked_places" }>,
  onFindings: (findings: AgentMapFinding[]) => void,
) {
  const results = await Promise.allSettled(action.places.map(place => findAssistantLocation(place.name)));
  const findings = results.flatMap((result, index): AgentMapFinding[] => {
    const candidate = action.places[index];
    if (result.status !== "fulfilled" || !candidate) return [];
    return [{
      id: `agent-finding:${Date.now().toString(36)}:${index}`,
      name: result.value.displayName,
      latitude: result.value.latitude,
      longitude: result.value.longitude,
      ...(result.value.geometry &&
        (result.value.geometry.type === "Polygon" || result.value.geometry.type === "MultiPolygon")
        ? { geometry: result.value.geometry }
        : {}),
      rank: candidate.rank,
      rationale: candidate.rationale,
      evidence: candidate.evidence,
      confidence: "screening",
      locationSource: result.value.provider,
    }];
  });
  if (!findings.length) {
    const firstFailure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    throw new Error(firstFailure?.reason instanceof Error ? firstFailure.reason.message : "No candidate place could be verified.");
  }
  onFindings(findings);
  useApp.getState().setAgentFindings(findings);
  const failed = results.length - findings.length;
  const state = useApp.getState();
  const latitudes = findings.map(item => item.latitude);
  const longitudes = findings.map(item => item.longitude);
  const span = Math.max(
    Math.max(...latitudes) - Math.min(...latitudes),
    Math.max(...longitudes) - Math.min(...longitudes),
  );
  state.flyTo({
    lat: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
    lng: (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
    altitude: Math.max(0.06, Math.min(1.4, span / 42)),
  });
  const mapped = findings.map(({ id, name, latitude, longitude, rank, rationale, evidence, confidence }) => ({
    id,
    name,
    coordinates: { latitude, longitude },
    rank,
    rationale,
    evidence,
    confidence,
  }));
  return `Mapped ${findings.length} ranked candidate place(s) with geocoder-verified coordinates as screening findings.${failed ? ` ${failed} candidate place(s) could not be geocoded and were omitted.` : ""} Structured findings: ${JSON.stringify(mapped)}`;
}

function resolveAssistantLocation(query: string) {
  const state = useApp.getState();
  const current = state.locationResult;
  const resolvedName = current?.displayName.split(",")[0]?.trim().toLocaleLowerCase();
  return current &&
    state.aoi?.name === current.displayName &&
    (current.displayName.toLocaleLowerCase() === query.toLocaleLowerCase() ||
      resolvedName === query.toLocaleLowerCase())
    ? Promise.resolve(current)
    : applyAssistantLocation(query);
}

function setNamedRegion(regionName: KnownRegion) {
  const region = REGIONS[regionName];
  const app = useApp.getState();
  if (region.bounds) {
    const [west, south, east, north] = region.bounds;
    app.setAOI({ ...rectangleAOI([west, south], [east, north]), name: region.name });
  } else {
    app.setAOI(null);
  }
  app.flyTo({ lat: region.lat, lng: region.lng, altitude: region.altitude });
}

async function executeWeatherContext(action: Extract<Action, { type: "get_weather_context" }>) {
  const location = action.locationQuery
    ? await resolveAssistantLocation(action.locationQuery)
    : null;
  const current = useApp.getState();
  const center = location
    ? { lat: location.latitude, lng: location.longitude }
    : current.aoi?.center ?? { lat: current.view.lat, lng: current.view.lng };
  await current.refreshMeteomatics(center);

  const result = useApp.getState();
  const weather = result.meteomaticsContext;
  if (result.meteomaticsStatus === "not-configured" || !weather?.configured) {
    return `Meteomatics weather is not configured${location ? ` for ${location.displayName}` : current.aoi ? ` for ${current.aoi.name}` : " for the current globe center"}. No weather measurements are available. Configure the server-only Meteomatics credentials to enable this source.`;
  }
  if (result.meteomaticsStatus === "error") {
    return `Meteomatics weather could not be retrieved: ${result.meteomaticsError ?? "provider request failed"}.`;
  }
  if (!weather.values.length) {
    return `Meteomatics is configured, but returned no weather measurements${location ? ` for ${location.displayName}` : ""}.`;
  }
  const values = weather.values.map(item => `${item.label}: ${item.value} ${item.unit}`).join("; ");
  return `Meteomatics weather context${location ? ` for ${location.displayName}` : current.aoi ? ` for ${current.aoi.name}` : " at the current globe center"}${weather.observedAt ? ` (${weather.observedAt})` : ""}: ${values}. This is weather context, not a crop-suitability or hazard analysis.`;
}

async function executeNISARSearch(action: Extract<Action, { type: "search_nisar" }>) {
  if (action.locationQuery) {
    const location = await resolveAssistantLocation(action.locationQuery);
    void useApp.getState().refreshMeteomatics({ lat: location.latitude, lng: location.longitude });
  } else if (action.region) {
    setNamedRegion(action.region);
  }
  const app = useApp.getState();
  app.toggleLayer("nisar-coverage", true);
  const codes = action.productCodes?.length ? action.productCodes : app.nisarSelectedProductCodes;
  codes.forEach(code => app.toggleLayer(`prod-${code}`, true));
  app.setNISARProductSelection(codes);
  await app.refreshNISARData(codes);
  if (!(await waitForNISARDataRefresh())) {
    return "The NASA CMR search is still running. Its results will appear in the data explorer when ready.";
  }
  const result = useApp.getState();
  return summarizeNISARSearch({
    status: result.nisarStatus,
    error: result.nisarError,
    granules: result.nisarGranules,
    hits: result.nisarGranuleHits,
  });
}

function triggerDownload(url: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function triggerTextDownload(filename: string, content: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  triggerDownload(url, filename);
  URL.revokeObjectURL(url);
}

async function downloadGuestNISARExport(format: "pdf" | "csv" | "json" | "geotiff" | "screening_mask" | "uncertainty_cog" | "water_screening_cog") {
  const capability = readGuestNISARCapability();
  if (!capability) throw new Error("There is no guest NISAR investigation saved in this browser session.");
  const job = await getGuestNISARStatus(capability);
  if (job.status !== "completed" || !job.result) {
    throw new Error("The guest NISAR investigation must be completed before its exports can be downloaded.");
  }
  const result = job.result;
  const summary = result.summary && typeof result.summary === "object" && !Array.isArray(result.summary)
    ? result.summary as Record<string, unknown>
    : null;
  if (format === "geotiff" || format === "screening_mask" || format === "uncertainty_cog" || format === "water_screening_cog") {
    const urlKey = format === "geotiff" ? "raster_url" : format === "screening_mask" ? "screening_mask_url" : format === "uncertainty_cog" ? "uncertainty_url" : "water_screening_mask_url";
    const url = result[urlKey];
    if (typeof url !== "string" || !url.startsWith("https://")) {
      throw new Error(format === "geotiff"
        ? "The full-resolution GeoTIFF is not available for this investigation."
        : format === "screening_mask"
          ? "The negative-change screening mask is not available for this investigation."
          : format === "uncertainty_cog"
          ? "The measurement-noise uncertainty COG is not available for this investigation."
          : "The provisional JRC-informed candidate-water screening COG is not available for this investigation.");
    }
    const filename = format === "geotiff"
      ? "third-eye-" + job.id + "-nisar-gcov-change.tif"
      : format === "screening_mask"
        ? "third-eye-" + job.id + "-negative-change-screening.tif"
        : format === "uncertainty_cog"
          ? "third-eye-" + job.id + "-measurement-noise-uncertainty.tif"
          : "third-eye-" + job.id + "-candidate-new-water-screening.tif";
    triggerDownload(url, filename);
    const label = format === "geotiff"
      ? "full-resolution NISAR GeoTIFF"
      : format === "screening_mask"
        ? "negative-change screening COG"
        : format === "uncertainty_cog"
          ? "measurement-noise uncertainty COG"
          : "provisional JRC-informed candidate-water screening COG";
    return "Started the " + label + " download for investigation " + job.id
      + ". The signed URL was kept out of the assistant conversation.";
  }
  if (format === "csv") {
    if (!summary) throw new Error("The completed investigation does not contain a numeric summary.");
    const rows = Object.entries(summary).filter((entry): entry is [string, number] =>
      typeof entry[1] === "number" && Number.isFinite(entry[1]),
    );
    if (!rows.length) throw new Error("The investigation summary contains no numeric values to export.");
    const csv = ["metric,value", ...rows.map(([key, value]) => key + "," + value)].join("\\n");
    triggerTextDownload("third-eye-" + job.id + "-summary.csv", csv, "text/csv;charset=utf-8");
    return "Started the CSV summary download for investigation " + job.id + ".";
  }
  if (format === "json") {
    const safeResult = { ...result };
    delete safeResult.raster_url;
    delete safeResult.preview_url;
    delete safeResult.screening_mask_url;
    delete safeResult.uncertainty_url;
    delete safeResult.uncertainty_preview_url;
    delete safeResult.water_screening_mask_url;
    const bundle = {
      report_type: "NISAR GCOV backscatter change measurement",
      generated_at: new Date().toISOString(),
      job_id: job.id,
      status: job.status,
      result: safeResult,
      provenance: job.provenance,
      validation: result.independent_reference_agreement ?? { performed: false, reason: "No independent reference comparison was run." },
      interpretation_limits: [
        "Backscatter change is not a water or flood classification.",
        "The worker clips the derived raster to pixel centres inside the submitted polygon; boundary pixels are not area-fraction weighted.",
        "Any OPERA comparison measures exploratory agreement of the fixed-threshold screening proxy; it is not flood-classifier validation.",
        "No calibrated probability or confidence score is generated by this workflow.",
      ],
    };
    triggerTextDownload("third-eye-" + job.id + "-provenance.json", JSON.stringify(bundle, null, 2), "application/json");
    return "Started the JSON provenance download for investigation " + job.id + ". Temporary signed URLs were excluded from the export.";
  }
  if (!summary) throw new Error("The completed investigation does not contain a report summary.");
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();
  const lines = [
    "THIRD EYE — NISAR GCOV CHANGE REPORT",
    "Job: " + job.id,
    "Generated: " + new Date().toISOString(),
    "Measurement: After-minus-before gamma0 backscatter change",
    "Status: " + job.status,
    "",
    "SUMMARY",
    ...Object.entries(summary).map(([key, value]) => key + ": " + String(value)),
    "",
    "SCIENTIFIC LIMITATIONS",
    "This report describes measured gamma0 backscatter change only. It does not provide a water mask, flood extent, or hazard classification.",
    "The derived raster is clipped to pixel centres inside the submitted polygon; boundary pixels are not area-fraction weighted.",
    "Any OPERA agreement metrics are exploratory screening-proxy comparisons, not flood-classifier validation.",
    "No calibrated probability or confidence score is generated by this workflow.",
  ];
  let y = 16;
  for (const line of lines) {
    const wrapped = doc.splitTextToSize(line, 180);
    if (y + wrapped.length * 5 > 282) { doc.addPage(); y = 16; }
    doc.text(wrapped, 14, y);
    y += wrapped.length * 5 + 1;
  }
  doc.save("third-eye-" + job.id + "-scientific-report.pdf");
  return "Generated and saved the scientific PDF report for investigation " + job.id + ". The report includes the measured summary and scientific limitations.";
}

function execute(
  action: Action,
  signal?: AbortSignal,
  onFindings?: (findings: AgentMapFinding[]) => void,
): Promise<string | null> | null {
  const s = useApp.getState();
  if (action.type === "fly_to") { s.flyTo({ lat: action.lat, lng: action.lng, altitude: action.altitude ?? 0.4 }); return null; }
  if (action.type === "search_location") {
    return applyAssistantLocation(action.locationQuery).then(location =>
      `Focused the map on ${location.displayName} and set it as the current area of interest.`,
    );
  }
  if (action.type === "get_weather_context") return executeWeatherContext(action);
  if (action.type === "get_climate_context") return executeClimateContext(action);
  if (action.type === "map_ranked_places" && onFindings) return executeRankedPlaces(action, onFindings);
  if (action.type === "select_result") {
    const state = useApp.getState();
    const event = state.liveEvents.find(item => item.id === action.recordId);
    const granule = state.nisarGranules.find(item => item.id === action.recordId);
    const observation = state.planetaryComputerResult?.items.find(item => item.id === action.recordId);
    const item = event ?? granule ?? observation;
    if (!item) return Promise.resolve("That record is not in the currently loaded results, so nothing was selected.");
    state.select(action.recordId);
    const title = "title" in item ? item.title : action.recordId;
    const date = "date" in item ? item.date : "startDate" in item ? item.startDate : item.datetime;
    return Promise.resolve(`Selected ${title}${date ? ` (${date.slice(0, 10)})` : ""} on the map.`);
  }
  if (action.type === "set_layer") {
    s.toggleLayer(action.layer, action.enabled);
    return null;
  }
  if (action.type === "refresh_live") {
    return (async () => {
      await s.refreshLiveData();
      await waitForLiveDataRefresh(signal);
      const state = useApp.getState();
      return `Live provider refresh complete. USGS: ${state.liveProviderStatus.usgs.status}${state.liveProviderStatus.usgs.error ? ` (${state.liveProviderStatus.usgs.error})` : ""}; NASA EONET: ${state.liveProviderStatus.eonet.status}${state.liveProviderStatus.eonet.error ? ` (${state.liveProviderStatus.eonet.error})` : ""}.`;
    })();
  }
  if (action.type === "switch_earth_view") { s.setEarthMode(action.view); return null; }
  if (action.type === "set_time_range") { s.setTimeRange({ start: action.start, end: action.end }); return null; }
  if (action.type === "search_nisar") return executeNISARSearch(action);
  if (action.type === "search_intelligence") {
    return (async () => {
      if (action.locationQuery) {
        const location = await resolveAssistantLocation(action.locationQuery);
        void useApp.getState().refreshMeteomatics({ lat: location.latitude, lng: location.longitude });
      } else if (action.scope === "global") {
        useApp.getState().setAOI(null);
        useApp.getState().flyTo({ lat: 0, lng: 0, altitude: 2.4 });
      }
      const app = useApp.getState();
      const workflow = getIntelligenceWorkflow(action.workflowId);
      app.setMode("intelligence");
      app.setActiveIntelligenceWorkflow(action.workflowId);
      app.toggleLayer("nisar-coverage", true);
      for (const productCode of workflow.nisarProductCodes) {
        app.toggleLayer(`prod-${productCode}`, true);
      }
      const requests = [
        app.refreshNISARData([...workflow.nisarProductCodes]),
        app.refreshPlanetaryComputer(action.workflowId),
        app.refreshMeteomatics(app.aoi?.center),
      ];
      if (workflow.eventTypes.length) requests.push(app.refreshLiveData());
      await Promise.all(requests);
      if (workflow.eventTypes.length) await waitForLiveDataRefresh(signal);
      const state = useApp.getState();
      const nisarSummary = state.nisarStatus === "error"
        ? `NASA CMR: ${state.nisarError ?? "search failed"}`
        : `NASA CMR: ${state.nisarGranuleHits.toLocaleString()} catalog match(es), ${state.nisarGranules.length} loaded`;
      const planetarySummary = state.planetaryComputerStatus === "error"
        ? `Planetary Computer: ${state.planetaryComputerError ?? "search failed"}`
        : `Planetary Computer: ${state.planetaryComputerResult?.items.length ?? 0} STAC item(s) returned`;
      return `${workflow.label} discovery complete. ${nisarSummary}. ${planetarySummary}. These are catalog records; no derived analysis was run.`;
    })();
  }
  if (action.type === "run_nisar_gcov_change") {
    return (async () => {
      const state = useApp.getState();
      const before = state.nisarGranules.find(item => item.id === action.beforeRecordId || item.conceptId === action.beforeRecordId);
      const after = state.nisarGranules.find(item => item.id === action.afterRecordId || item.conceptId === action.afterRecordId);
      if (!before || !after) throw new Error("The requested before/after records are not both present in the loaded NISAR catalog. Search NISAR again and retry.");
      if (before.productCode !== "GCOV" || after.productCode !== "GCOV") {
        throw new Error("Only loaded NISAR GCOV granules can be used for this comparison.");
      }
      if (!before.startDate || !after.startDate || Date.parse(before.startDate) >= Date.parse(after.startDate)) {
        throw new Error("The NISAR comparison needs a chronologically earlier before acquisition and later after acquisition.");
      }
      if (!state.aoi || !["Polygon", "MultiPolygon"].includes(state.aoi.feature.geometry.type)) {
        throw new Error("Draw or select a polygon AOI before starting a guest NISAR comparison.");
      }
      const submitted = await submitGuestNISARComparison({
        before,
        after,
        aoi: state.aoi.feature.geometry,
        frequency: action.frequency,
        polarizationTerm: action.polarizationTerm,
      });
      const job = submitted.job;
      return "Public NISAR GCOV comparison " + job.id + " was queued successfully. Status: " + job.status
        + "; stage: " + job.stage + "; progress: " + job.progress
        + "%. This is queued processing, not a completed scientific result. Use get_nisar_investigation_status to check it later.";
    })();
  }
  if (action.type === "get_nisar_investigation_status") {
    return (async () => {
      const capability = readGuestNISARCapability();
      if (!capability) throw new Error("There is no guest NISAR investigation saved in this browser session.");
      const job = await getGuestNISARStatus(capability);
      if (job.status === "completed" && job.result && typeof job.result.summary === "object") {
        const summary = job.result.summary as Record<string, unknown>;
        return "Guest NISAR investigation " + job.id + " is completed. Mean gamma0 backscatter change: "
          + (typeof summary.mean_delta_db === "number" ? summary.mean_delta_db.toFixed(3) : "not available")
          + " dB; median: " + (typeof summary.median_delta_db === "number" ? summary.median_delta_db.toFixed(3) : "not available")
          + " dB; valid pixels: " + (typeof summary.valid_pixels === "number" ? summary.valid_pixels.toLocaleString() : "not available")
          + ". This is a derived backscatter measurement, not a water or flood classification.";
      }
      return "Guest NISAR investigation " + job.id + " status: " + job.status + "; stage: " + job.stage
        + "; progress: " + job.progress + "%. " + (job.errorMessage ?? "No completed raster result is available yet.");
    })();
  }
  if (action.type === "download_nisar_export") {
    return downloadGuestNISARExport(action.format);
  }
  if (action.type === "cancel_nisar_investigation") {
    return (async () => {
      const capability = readGuestNISARCapability();
      if (!capability) throw new Error("There is no guest NISAR investigation saved in this browser session.");
      const job = await cancelGuestNISARJob(capability);
      return "Guest NISAR investigation " + job.id + " cancellation requested. Current status: " + job.status
        + "; stage: " + job.stage + ". The worker may take a short time to acknowledge cancellation if processing has already started.";
    })();
  }
  if (action.type === "process_selected_sentinel2_ndvi") {
    return (async () => {
      await useApp.getState().startSentinel2NDVI();
      const job = useApp.getState().scientificJob;
      if (!job) throw new Error("The scientific job was not available after submission.");
      if (job.status === "completed" && job.result) {
        const summary = job.result.summary;
        return `Sentinel-2 NDVI processing completed for ${job.itemId}. Mean ${summary.mean.toFixed(3)}, median ${summary.median.toFixed(3)}, ${summary.valid_pixels.toLocaleString()} valid pixels at ${summary.spatial_resolution_m} m resolution. This is a single-date vegetation-index measurement, not a crop-health diagnosis or temporal change result.`;
      }
      return `Sentinel-2 NDVI processing job ${job.id} is ${job.status} (${job.progress}% complete, stage: ${job.stage}). This is queued work, not a completed scientific result.`;
    })();
  }
  return null;
}
type AssistantHistory = Array<{ role: "user" | "assistant"; content: string }>;
type AssistantPhase = "plan" | "final";
type AssistantAPIResponse = {
  message?: unknown;
  actions?: unknown;
  mode?: unknown;
  warning?: unknown;
  error?: unknown;
};
const MAX_AGENT_ITERATIONS = 4;
const MAX_AGENT_ACTIONS = 8;
const MAX_AGENT_RESULTS = 8;

function assistantContext(message: string) {
  const state = useApp.getState();
  const selectedGranule = state.nisarGranules.find(item => item.id === state.selectedId);
  const selectedEvent = state.liveEvents.find(item => item.id === state.selectedId);
  const selectedObservation = state.planetaryComputerResult?.items.find(item => item.id === state.selectedId);
  return {
    view: state.view,
    activeLayers: [...state.layers],
    timeRange: state.time,
    aoi: state.aoi ? { name: state.aoi.name, bounds: state.aoi.bounds } : null,
    location: state.locationResult
      ? { name: state.locationResult.displayName, latitude: state.locationResult.latitude, longitude: state.locationResult.longitude }
      : null,
    activeIntelligenceWorkflowId: state.activeIntelligenceWorkflowId,
    previousAgentFindings: state.agentFindings.slice(0, 4).map(finding => ({
      id: finding.id,
      name: finding.name,
      rank: finding.rank,
      latitude: finding.latitude,
      longitude: finding.longitude,
      rationale: finding.rationale,
      evidence: finding.evidence.slice(0, 2),
    })),
    selectedRecord: selectedGranule
      ? { id: selectedGranule.id, title: selectedGranule.granuleId, source: "NASA CMR", date: selectedGranule.startDate }
      : selectedEvent
        ? { id: selectedEvent.id, title: selectedEvent.title, source: selectedEvent.source, date: selectedEvent.date }
        : selectedObservation
          ? { id: selectedObservation.id, title: selectedObservation.title, source: "Microsoft Planetary Computer", collection: selectedObservation.collectionId, date: selectedObservation.datetime ?? undefined }
          : null,
    data: {
      nisar: {
        status: state.nisarStatus,
        hits: state.nisarGranuleHits,
        loaded: state.nisarGranules.length,
        records: [...state.nisarGranules]
          .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""))
          .slice(0, 10).map(granule => ({
          id: granule.id,
          title: granule.title,
          granuleId: granule.granuleId,
          collectionConceptId: granule.collectionConceptId,
          product: granule.productCode,
          date: granule.startDate,
          orbitDirection: granule.orbitDirection,
          trackNumber: granule.trackNumber,
          frameNumber: granule.frameNumber,
          hasFootprint: Boolean(granule.footprint),
          hasBounds: Boolean(granule.bounds),
        })),
      },
      planetaryComputer: {
        status: state.planetaryComputerStatus,
        records: [...(state.planetaryComputerResult?.items ?? [])]
          .sort((a, b) => (b.datetime ?? "").localeCompare(a.datetime ?? ""))
          .slice(0, 4).map(item => ({
          id: item.id,
          title: item.title,
          collection: item.collectionLabel,
          date: item.datetime,
          platform: item.platform,
        })),
      },
      live: {
        status: state.liveDataStatus,
        usgsStatus: state.liveProviderStatus.usgs.status,
        eonetStatus: state.liveProviderStatus.eonet.status,
        records: [...state.liveEvents]
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 6).map(event => ({
          id: event.id,
          source: event.source,
          title: event.title,
          region: event.region,
          date: event.date,
          metric: event.metric,
        })),
      },
      weather: {
        status: state.meteomaticsStatus,
        configured: state.meteomaticsContext?.configured ?? false,
        observedAt: state.meteomaticsContext?.observedAt ?? null,
        values: state.meteomaticsContext?.values ?? [],
      },
      scientificProcessing: state.scientificJob
        ? {
            workflow: "sentinel2-ndvi",
            jobId: state.scientificJob.id,
            itemId: state.scientificJob.itemId,
            status: state.scientificJob.status,
            stage: state.scientificJob.stage,
            progress: state.scientificJob.progress,
            summary: state.scientificJob.status === "completed" ? state.scientificJob.result?.summary ?? null : null,
            provenance: state.scientificJob.status === "completed" ? state.scientificJob.provenance : null,
            error: state.scientificJob.errorMessage,
          }
        : null,
    },
    previousAgentInvestigation: state.agentInvestigation
      ? {
          goal: state.agentInvestigation.goal,
          confidence: state.agentInvestigation.confidence,
          limitations: state.agentInvestigation.limitations.slice(0, 4),
        }
      : null,
  };
}

async function requestAssistant(
  message: string,
  history: AssistantHistory,
  phase: AssistantPhase,
  executionResults: AssistantExecutionResult[],
  signal?: AbortSignal,
) {
  const response = await fetch("/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    ...(signal ? { signal } : {}),
    body: JSON.stringify({
      message,
      history,
      phase,
      executionResults: executionResults.slice(-MAX_AGENT_RESULTS),
      context: assistantContext(message),
    }),
  });
  const data = await response.json() as AssistantAPIResponse;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `Assistant API returned HTTP ${response.status}.`);
  return data;
}

export async function runCommand(raw: string, options: RunCommandOptions = {}) {
  const message = raw.trim();
  if (!message) return false;
  const s = useApp.getState();
  const history: AssistantHistory = s.aiMessages.slice(-20).map(item => ({
    role: item.role === "user" ? "user" as const : "assistant" as const,
    content: redactSensitiveText(item.text).slice(0, 180),
  }));
  s.setAIActive(true);
  s.pushMessage({ id: uid(), role: "user", text: message, ...(options.voice ? { voice: true } : {}) });
  s.setSteps("THIRD EYE", [{ label: "Sending command to backend", status: "active" }]);
  try {
    if (options.signal?.aborted) {
      s.setSteps(null, null);
      return false;
    }
    const actionResults: AssistantExecutionResult[] = [];
    let navigationExecuted = false;
    const mappedFindings: { current: AgentMapFinding[] | null } = { current: null };
    const executedActions: Action[] = [];
    const seenActions = new Set<string>();
    let totalActions = 0;
    let planningRounds = 0;
    let stoppedByAgentDecision = false;
    let actionBudgetReached = false;
    const agentWarnings: string[] = [];
    let replyData: AssistantAPIResponse = {
      message: "I couldn't make progress on this investigation with the available tools.",
      actions: [],
      mode: "ai",
    };
    const progressSteps: AIStep[] = [{ label: "Understanding your request", status: "done" }];
    const actionLabel = (action: Action) => {
      if (action.type === "search_location") return "Resolving the requested geographic scope";
      if (action.type === "search_nisar") return "Searching NASA CMR NISAR coverage";
      if (action.type === "search_intelligence") return "Searching real observation catalogs";
      if (action.type === "get_weather_context") return "Checking current weather measurements";
      if (action.type === "download_nisar_export") return "Preparing NISAR " + action.format + " export";
      if (action.type === "get_climate_context") {
        return action.locationQueries
          ? `Comparing historical environmental context for ${action.locationQueries.length} candidate places`
          : action.locationQuery
            ? `Retrieving historical environmental context for ${action.locationQuery}`
            : "Retrieving historical environmental context for the selected area";
      }
      if (action.type === "map_ranked_places") return "Verifying and mapping ranked candidate places";
      if (action.type === "process_selected_sentinel2_ndvi") return "Queueing Sentinel-2 NDVI processing";
      if (action.type === "run_nisar_gcov_change") return "Queueing public NISAR GCOV comparison";
      if (action.type === "get_nisar_investigation_status") return "Checking guest NISAR investigation status";
      if (action.type === "refresh_live") return "Refreshing source-reported public events";
      if (action.type === "select_result") return "Selecting a loaded result on the map";
      if (action.type === "navigate" && action.route === "/analyze") return "Opening analysis tools over the shared Earth view";
      if (action.type === "navigate") return "Opening the requested section";
      if (action.type === "set_time_range") return "Updating the observation time range";
      if (action.type === "switch_earth_view") return `Switching to the ${action.view} Earth view`;
      if (action.type === "set_layer") return `${action.enabled ? "Showing" : "Hiding"} ${action.layer}`;
      return "Moving the shared Earth view";
    };

    for (let iteration = 0; iteration < MAX_AGENT_ITERATIONS; iteration += 1) {
      if (options.signal?.aborted) {
        useApp.getState().setSteps(null, null);
        return false;
      }
      progressSteps.push({ label: `Reviewing evidence and choosing next steps (${iteration + 1}/${MAX_AGENT_ITERATIONS})`, status: "active" });
      useApp.getState().setSteps("THIRD EYE", [...progressSteps]);
      const data = await requestAssistant(message, history, "plan", actionResults, options.signal);
      planningRounds = iteration + 1;
      if (typeof data.warning === "string" && data.warning) agentWarnings.push(data.warning);
      if (options.signal?.aborted) {
        useApp.getState().setSteps(null, null);
        return false;
      }
      replyData = data;
      const actionContext = [
        ...history.filter(entry => entry.role === "user").map(entry => entry.content),
        message,
        ...actionResults.map(result => result.summary),
      ].join("\n");
      const proposed = Array.isArray(data.actions)
        ? data.actions.map(action => validateAssistantAction(action, actionContext)).filter((value): value is Action => value !== null)
        : [];
      const actions = proposed.filter(action => {
        const key = JSON.stringify(action);
        if (seenActions.has(key)) return false;
        seenActions.add(key);
        return true;
      }).slice(0, Math.max(0, MAX_AGENT_ACTIONS - totalActions));

      if (!actions.length || data.mode !== "ai") {
        stoppedByAgentDecision = true;
        break;
      }
      let completedActions = 0;
      for (const action of actions) {
        if (options.signal?.aborted) {
          useApp.getState().setSteps(null, null);
          return false;
        }
        totalActions += 1;
        completedActions += 1;
        executedActions.push(action);
        const stepIndex = progressSteps.length - 1;
        progressSteps[stepIndex] = { label: progressSteps[stepIndex]?.label ?? "Reviewing evidence", status: "done" };
        progressSteps.push({ label: actionLabel(action), status: "active" });
        useApp.getState().setSteps("THIRD EYE", [...progressSteps]);
        let stepStatus: AIStep["status"] = "done";
        if (action.type === "navigate") {
          if (options.onNavigate) {
            options.onNavigate(action.route);
            navigationExecuted = true;
          }
        } else {
          try {
            const result = execute(action, options.signal, findings => { mappedFindings.current = findings; });
            if (result) {
              const summary = await result;
              if (summary) {
                const executionResult = createAssistantExecutionResult(action, summary);
                actionResults.push(executionResult);
                if (executionResult.status === "failed") stepStatus = "error";
              }
            }
          } catch (error) {
            const detail = error instanceof Error ? error.message : "unknown error";
            stepStatus = "error";
            actionResults.push(createAssistantExecutionResult(
              action,
              `Could not complete ${action.type.replaceAll("_", " ")}: ${detail}`,
              "failed",
            ));
          }
        }
        progressSteps[progressSteps.length - 1] = {
          label: actionLabel(action),
          status: stepStatus,
        };
        useApp.getState().setSteps("THIRD EYE", [...progressSteps]);
      }
      if (completedActions === 0 || totalActions >= MAX_AGENT_ACTIONS) {
        actionBudgetReached = totalActions >= MAX_AGENT_ACTIONS;
        stoppedByAgentDecision = true;
        break;
      }
    }
    if (actionBudgetReached) {
      agentWarnings.push(`Stopped after the ${MAX_AGENT_ACTIONS}-action investigation limit.`);
    } else if (!stoppedByAgentDecision && planningRounds >= MAX_AGENT_ITERATIONS) {
      agentWarnings.push(`Stopped after ${MAX_AGENT_ITERATIONS} investigation rounds; the result may be incomplete.`);
    }

    if (options.signal?.aborted) {
      useApp.getState().setSteps(null, null);
      return false;
    }
    if (actionResults.length > 0 && replyData.mode === "ai") {
      progressSteps.push({ label: "Synthesizing findings, sources, and limitations", status: "active" });
      useApp.getState().setSteps("THIRD EYE", [...progressSteps]);
      try {
        replyData = await requestAssistant(message, history, "final", actionResults, options.signal);
        if (typeof replyData.warning === "string" && replyData.warning) agentWarnings.push(replyData.warning);
      } catch (error) {
        if (options.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
          useApp.getState().setSteps(null, null);
          return false;
        }
        const detail = error instanceof Error ? error.message : "unknown error";
        actionResults.push({
          tool: "final_synthesis",
          status: "failed",
          evidenceLevel: "insufficient_evidence",
          source: "Groq",
          summary: `Final source-grounded answer could not be generated: ${detail}`,
        });
        replyData = {
          ...replyData,
          warning: "The tools ran, but final synthesis failed. The available evidence is shown below.",
        };
      }
    }
    if (options.signal?.aborted) {
      useApp.getState().setSteps(null, null);
      return false;
    }
    const buttons = (options.voice || navigationExecuted ? [] : executedActions.filter((a): a is Extract<Action, { type: "navigate" }> => a.type === "navigate"))
      .map(a => ({ label: a.route === "/data" ? "Open NISAR data" : a.route === "/analyze" ? "Open analysis" : "Open section", run: `navigate:${a.route}` }));
    if (!buttons.length && executedActions.some(a => a.type === "search_nisar")) buttons.push({ label: "Open NISAR data", run: "navigate:/data" });
    const warnings = [...new Set(agentWarnings)];
    const warning = warnings.length ? ` ${warnings.join(" ")}` : "";
    const note = replyData.mode === "rules" ? " (Rule-based mode; configure GROQ_API_KEY and GROQ_MODEL for Groq AI.)" : "";
    const executionIssues = actionResults
      .filter(result => result.status !== "completed" &&
        !(typeof replyData.message === "string" && replyData.message.includes(result.summary)))
      .map(result => `${result.status === "partial" ? "Partial result" : "Tool unavailable"} — ${result.source}: ${formatAssistantExecutionSummary(result)}`);
    const answer = [
      typeof replyData.message === "string" ? replyData.message : "Command processed.",
      ...(replyData.mode === "rules" ? actionResults.map(formatAssistantExecutionSummary) : []),
      ...executionIssues,
      warning.trim(),
      note.trim(),
    ].filter(Boolean).join(" ");
    const state = useApp.getState();
    const findings = mappedFindings.current ?? [];
    const limitations = [
      ...(findings.length ? ["Mapped recommendations are qualitative AI screening results, not a validated suitability model or parcel-level assessment."] : []),
      ...actionResults.filter(result => result.status !== "completed").map(result => `${result.source}: ${result.summary}`),
    ];
    state.setAgentInvestigation({
      goal: message,
      summary: findings.length
        ? `${findings.length} ranked candidate location${findings.length === 1 ? "" : "s"} mapped as qualitative screening findings.`
        : answer.split(/\r?\n/)[0]?.slice(0, 240) ?? "",
      answer,
      findings,
      mapActions: findings.length
        ? [{ type: "map_ranked_places", findingIds: findings.map(finding => finding.id) }]
        : [],
      evidence: actionResults.slice(-MAX_AGENT_RESULTS),
      sources: [...new Set(actionResults.filter(result => result.status !== "failed").map(result => result.source))],
      limitations,
      confidence: findings.length ? "screening" : "not-assessed",
      createdAt: new Date().toISOString(),
    });
    useApp.getState().setSteps(null, null);
    useApp.getState().pushMessage({ id: uid(), role: "system", text: answer, actions: buttons, ...(options.voice ? { voice: true } : {}) });
    if (options.voice) await options.onResponse?.(prepareSpokenResponse(answer));
    return true;
  } catch (error) {
    useApp.getState().setSteps(null, null);
    if (options.signal?.aborted || (error instanceof Error && error.name === "AbortError")) return false;
    const answer = error instanceof Error ? `The assistant backend could not be reached: ${error.message}` : "The assistant backend could not be reached.";
    useApp.getState().pushMessage({ id: uid(), role: "system", text: answer, ...(options.voice ? { voice: true } : {}) });
    if (options.voice) await options.onResponse?.(prepareSpokenResponse(answer));
    return false;
  }
}
export function applyAssistantAction(raw: string): boolean {
  if (!raw.startsWith("action:")) return false;
  try {
    const action = validateAssistantAction(JSON.parse(decodeURIComponent(raw.slice(7))) as unknown, "");
    if (!action) return false;
    void execute(action);
    return true;
  }
  catch { return false; }
}
