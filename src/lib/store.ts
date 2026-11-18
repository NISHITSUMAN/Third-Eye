import { create } from "zustand";
import { EARTH_EVENTS, confidenceRank, lodForAltitude, severityBand, type EarthEventRecord, type EarthMode, type EvidenceClass, type LodBand, type SeverityBand } from "./earth-data";
import {
  circleAOI,
  distanceKm,
  makeAOI,
  polygonAOI,
  rectangleAOI,
  type AOI,
  type AnalysisResult,
  type DrawTool,
} from "./analysis";
import type { Position } from "geojson";
import type { Phenomenon } from "./earth-vocabulary";
import { fetchLiveEarthData, type LiveEarthEvent, type LiveFeedStatus } from "./live-data";
import type { NISARCollection, NISARGranule, NISARCoverageResult } from "./nasa-cmr";
import { fetchReverseGeocode, type GeoSearchResult } from "./geocode";
import { geometryBounds } from "./geographic-results";
import type { IntelligenceWorkflowId } from "./intelligence-workflows";
import type {
  MeteomaticsContext,
  PlanetaryComputerSearchResult,
  PlanetaryComputerStatus,
  PlanetaryComputerVisualization,
} from "./planetary-computer";
import {
  DEFAULT_NISAR_PRODUCTS as DEFAULT_NISAR_PRODUCT_CODES,
  NISAR_COVERAGE_PRODUCT_CODES,
  isNISARCoverageProductCode,
} from "./sar-registry";
import { redactSensitiveText } from "./sensitive-text";
import type { AgentInvestigation, AgentMapFinding } from "./agent-results";
import { getSupabaseClient } from "./auth";
import { parseScientificJob, type ScientificJob } from "./scientific-jobs";

export type Mode = "science" | "intelligence";
export type LiveFeedKey = "usgs" | "eonet";
export interface LiveFeedHealth {
  status: LiveFeedStatus;
  error: string | null;
  updatedAt: string | null;
  cached: boolean;
}
export type MeteomaticsStatus = "idle" | "loading" | "configured" | "ready" | "partial" | "not-configured" | "error";
export interface View { lat: number; lng: number; altitude: number }
export interface TimeRange { start: string; end: string; current: string }
export interface EarthFilter {
  types: Phenomenon[] | null;
  region: string | null;
  significance: "all" | "high" | "moderate+";
  confidence: "all" | "high" | "moderate+";
  severity: "all" | SeverityBand;
  evidence: "all" | EvidenceClass;
}
export interface InvestigationContext {
  region: string | null;
  selectedId: string | null;
  types: Phenomenon[] | null;
  comparison: "before-after" | "historical" | null;
  lastAnalysisId: string | null;
}
export interface AIStep { label: string; status: "done" | "active" | "pending" | "error" }
export interface AIMessage { id: string; role: "user" | "system"; text: string; actions?: { label: string; run: string }[] | undefined; voice?: boolean }

const ASSISTANT_CONVERSATION_KEY = "third-eye-conversation-v1";
const MAX_STORED_ASSISTANT_MESSAGES = 40;

export function readAssistantMessages(): AIMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(ASSISTANT_CONVERSATION_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(-MAX_STORED_ASSISTANT_MESSAGES).flatMap((item): AIMessage[] => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const message = item as Record<string, unknown>;
      if (typeof message.id !== "string" ||
          (message.role !== "user" && message.role !== "system") ||
          typeof message.text !== "string") return [];
      return [{
        id: message.id.slice(0, 120),
        role: message.role,
        text: redactSensitiveText(message.text).slice(0, 8_000),
        ...(message.voice === true ? { voice: true } : {}),
      }];
    });
  } catch (error) {
    console.warn("Could not restore the saved Third Eye conversation.", error);
    return [];
  }
}

function persistAssistantMessages(messages: AIMessage[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ASSISTANT_CONVERSATION_KEY, JSON.stringify(
      messages.slice(-MAX_STORED_ASSISTANT_MESSAGES).map(({ id, role, text, voice }) => ({
        id,
        role,
        text: redactSensitiveText(text),
        ...(voice ? { voice: true } : {}),
      })),
    ));
  } catch (error) {
    console.warn("Could not save the Third Eye conversation in this browser.", error);
  }
}

export interface GuestNISARMapResult {
  jobId: string;
  previewUrl: string;
  boundsWgs84: [number, number, number, number];
}

export interface AppState {
  aoi: AOI | null;
  drawTool: DrawTool | null;
  drawingPoints: Position[];
  drawingError: string | null;
  setDrawTool: (tool: DrawTool | null) => void;
  addDrawingPoint: (position: Position) => void;
  finishDrawing: () => void;
  analyses: AnalysisResult[];
  liveEvents: LiveEarthEvent[];
  liveDataStatus: "idle" | "loading" | "ready" | "partial" | "error";
  liveDataUpdatedAt: string | null;
  liveDataError: string | null;
  liveProviderStatus: Record<LiveFeedKey, LiveFeedHealth>;
  refreshLiveData: () => Promise<void>;
  planetaryComputerResult: PlanetaryComputerSearchResult | null;
  planetaryComputerStatus: PlanetaryComputerStatus;
  planetaryComputerWorkflowId: IntelligenceWorkflowId | null;
  planetaryComputerError: string | null;
  refreshPlanetaryComputer: (workflowId: IntelligenceWorkflowId) => Promise<void>;
  planetaryVisualization: PlanetaryComputerVisualization | null;
  planetaryVisualizationStatus: "idle" | "loading" | "ready" | "error";
  planetaryVisualizationError: string | null;
  requestPlanetaryVisualization: (id: string) => Promise<void>;
  scientificJob: ScientificJob | null;
  scientificJobSubmitting: boolean;
  scientificJobPreviewUrl: string | null;
  scientificJobRasterUrl: string | null;
  scientificJobError: string | null;
  guestNISARMapResult: GuestNISARMapResult | null;
  setGuestNISARMapResult: (result: GuestNISARMapResult | null) => void;
  restoreScientificJob: () => Promise<void>;
  startSentinel2NDVI: () => Promise<void>;
  refreshScientificJob: (jobId: string) => Promise<void>;
  cancelScientificJob: (jobId: string) => Promise<void>;
  meteomaticsContext: MeteomaticsContext | null;
  meteomaticsStatus: MeteomaticsStatus;
  meteomaticsError: string | null;
  refreshMeteomatics: (center?: { lat: number; lng: number }) => Promise<void>;
  locationResult: GeoSearchResult | null;
  locationStatus: "idle" | "loading" | "ready" | "error";
  locationError: string | null;
  lookupLocation: (latitude: number, longitude: number) => Promise<void>;
  setLocationResult: (result: GeoSearchResult | null) => void;
  nisarCollections: NISARCollection[];
  nisarCollectionHits: number;
  nisarProductCollections: NISARCollection[];
  nisarGranules: NISARGranule[];
  nisarGranuleHits: number;
  nisarGranuleHitsByProduct: NISARCoverageResult["granuleHitsByProduct"];
  nisarGranuleStatusByProduct: NISARCoverageResult["granuleStatusByProduct"];
  nisarPage: number;
  nisarHasMore: boolean;
  nisarSelectedProductCodes: string[];
  setNISARProductSelection: (productCodes: string[]) => void;
  nisarStatus: "idle" | "loading" | "ready" | "partial" | "error";
  nisarUpdatedAt: string | null;
  nisarError: string | null;
  refreshNISARData: (productCodes?: string[], page?: number, append?: boolean) => Promise<void>;
  setAOI: (aoi: AOI | null) => void;
  addAnalysis: (result: AnalysisResult) => void;
  sidebarCollapsed: boolean;
  analysisOpen: boolean;
  setAnalysisOpen: (open: boolean) => void;
  mode: Mode;
  activeIntelligenceWorkflowId: IntelligenceWorkflowId;
  setActiveIntelligenceWorkflow: (workflowId: IntelligenceWorkflowId) => void;
  earthMode: EarthMode;
  lod: LodBand;
  advanced: boolean;
  layers: Set<string>;
  opacity: Record<string, number>;
  selectedId: string | null;
  hoveredId: string | null;
  view: View;
  viewNonce: number;
  time: TimeRange;
  monthIndex: number;
  playing: boolean;
  playbackSpeed: 1 | 2 | 4;
  filter: EarthFilter;
  aiActive: boolean;
  aiMessages: AIMessage[];
  agentInvestigation: AgentInvestigation | null;
  agentFindings: AgentMapFinding[];
  aiSteps: AIStep[] | null;
  aiTitle: string | null;
  onboarded: boolean;
  guideStep: number | null;
  investigation: InvestigationContext;
  setSidebar: (value: boolean) => void;
  setMode: (mode: Mode) => void;
  setEarthMode: (mode: EarthMode) => void;
  setAdvanced: (value: boolean) => void;
  toggleLayer: (id: string, on?: boolean) => void;
  setOpacity: (id: string, value: number) => void;
  select: (id: string | null) => void;
  setHovered: (id: string | null) => void;
  flyTo: (view: Partial<View> & { lat: number; lng: number }) => void;
  syncView: (view: View) => void;
  setMonth: (month: number) => void;
  setCurrentDate: (date: string) => void;
  setTimeRange: (range: Pick<TimeRange, "start" | "end">) => void;
  setPlaying: (value: boolean) => void;
  setPlaybackSpeed: (value: 1 | 2 | 4) => void;
  setFilter: (filter: Partial<EarthFilter>) => void;
  resetFilter: () => void;
  setAIActive: (value: boolean) => void;
  pushMessage: (message: AIMessage) => void;
  setAgentFindings: (findings: AgentMapFinding[]) => void;
  setAgentInvestigation: (investigation: AgentInvestigation) => void;
  restoreAIMessages: (messages: AIMessage[]) => void;
  clearAIMessages: () => void;
  setSteps: (title: string | null, steps: AIStep[] | null) => void;
  setOnboarded: (value: boolean) => void;
  setGuideStep: (step: number | null) => void;
  setInvestigation: (value: Partial<InvestigationContext>) => void;
}

export const DEFAULT_FILTER: EarthFilter = { types: null, region: null, significance: "all", confidence: "all", severity: "all", evidence: "all" };

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function viewAltitudeForBounds(bounds: readonly number[] | null | undefined): number {
  if (!bounds || bounds.length !== 4 || !bounds.every(Number.isFinite)) return 0.12;
  return Math.max(0.002, Math.min(1.5, Math.max(bounds[2]! - bounds[0]!, bounds[3]! - bounds[1]!) / 30));
}

function createInitialTimeRange(): TimeRange {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setUTCFullYear(start.getUTCFullYear() - 2);
  return { start: dateKey(start), end: dateKey(today), current: dateKey(today) };
}

const INITIAL_TIME = createInitialTimeRange();
let latestNISARRequest = 0;
let latestLocationRequest = 0;
let latestPlanetaryComputerRequest = 0;
let latestMeteomaticsRequest = 0;
let latestVisualizationRequest = 0;
let planetaryComputerAbort: AbortController | null = null;
let nisarAbort: AbortController | null = null;
let nisarRequestKey: string | null = null;
let nisarRequestPromise: Promise<void> | null = null;
let visualizationAbort: AbortController | null = null;
let scientificJobPollTimer: ReturnType<typeof setTimeout> | null = null;
let scientificJobRestorePromise: Promise<void> | null = null;
const DEFAULT_NISAR_PRODUCTS = [...DEFAULT_NISAR_PRODUCT_CODES];

function scheduleScientificJobPoll(jobId: string) {
  if (typeof window === "undefined") return;
  const current = useApp.getState().scientificJob;
  if (current?.id !== jobId) return;
  if (scientificJobPollTimer) clearTimeout(scientificJobPollTimer);
  const delay = current.status === "queued" ? 15_000 : 3_000;
  scientificJobPollTimer = setTimeout(async () => {
    scientificJobPollTimer = null;
    const state = useApp.getState();
    if (state.scientificJob?.id !== jobId) return;
    try {
      await state.refreshScientificJob(jobId);
    } catch (error) {
      useApp.setState({
        scientificJobError: error instanceof Error ? error.message : "The scientific job status could not be refreshed.",
      });
    }
    const current = useApp.getState().scientificJob;
    if (current?.id === jobId && (current.status === "queued" || current.status === "processing")) {
      scheduleScientificJobPoll(jobId);
    }
  }, delay);
}

export const useApp = create<AppState>((set, get) => ({
  aoi: null,
  drawTool: null,
  drawingPoints: [],
  drawingError: null,
  setDrawTool: (drawTool) => set({ drawTool, drawingPoints: [], drawingError: null }),
  addDrawingPoint: (position) => {
    const state = useApp.getState();
    if (!state.drawTool) return;
    const points = [...state.drawingPoints, position];
    try {
      if (state.drawTool === "point") {
        state.setAOI(makeAOI({
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: position },
        }, "Point AOI"));
        return;
      }
      if (state.drawTool === "rectangle" && points.length >= 2) {
        state.setAOI(rectangleAOI(points[0]!, points[1]!));
        return;
      }
      if (state.drawTool === "circle" && points.length >= 2) {
        state.setAOI(circleAOI(points[0]!, distanceKm(points[0]!, points[1]!)));
        return;
      }
      set({ drawingPoints: points, drawingError: null });
    } catch (error) {
      set({
        drawingPoints: [],
        drawingError: error instanceof Error ? error.message : "The area could not be created from those points.",
      });
    }
  },
  finishDrawing: () => {
    const state = useApp.getState();
    if (state.drawTool !== "polygon") return;
    try {
      state.setAOI(polygonAOI(state.drawingPoints));
    } catch (error) {
      set({
        drawingError: error instanceof Error ? error.message : "The polygon could not be created from those points.",
      });
    }
  },
  analyses: [],
  liveEvents: [],
  liveDataStatus: "idle",
  liveDataUpdatedAt: null,
  liveDataError: null,
  liveProviderStatus: {
    usgs: { status: "idle", error: null, updatedAt: null, cached: false },
    eonet: { status: "idle", error: null, updatedAt: null, cached: false },
  },
  planetaryComputerResult: null,
  planetaryComputerStatus: "idle",
  planetaryComputerWorkflowId: null,
  planetaryComputerError: null,
  planetaryVisualization: null,
  planetaryVisualizationStatus: "idle",
  planetaryVisualizationError: null,
  scientificJob: null,
  scientificJobSubmitting: false,
  scientificJobPreviewUrl: null,
  scientificJobRasterUrl: null,
  scientificJobError: null,
  guestNISARMapResult: null,
  setGuestNISARMapResult: (result) => set((state) => ({
    guestNISARMapResult: result,
    layers: result
      ? new Set([...state.layers, "nisar-guest-result"])
      : new Set([...state.layers].filter(layer => layer !== "nisar-guest-result")),
  })),
  restoreScientificJob: async () => {
    if (useApp.getState().scientificJob) return;
    if (scientificJobRestorePromise) return scientificJobRestorePromise;
    const restore = (async () => {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) return;
      const { data, error } = await supabase
        .from("scientific_jobs")
        .select("id,item_id,status,stage,progress,error_message,result,provenance")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data || useApp.getState().scientificJob) return;
      const job = parseScientificJob(data);
      set({ scientificJob: job });
      if (job.status === "queued" || job.status === "processing") {
        scheduleScientificJobPoll(job.id);
      } else if (job.status === "completed") {
        await useApp.getState().refreshScientificJob(job.id);
      }
    })();
    scientificJobRestorePromise = restore;
    try {
      await restore;
    } finally {
      scientificJobRestorePromise = null;
    }
  },
  requestPlanetaryVisualization: async (id) => {
    const snapshot = useApp.getState();
    const item = snapshot.planetaryComputerResult?.items.find(observation => observation.id === id);
    if (!item || !snapshot.planetaryComputerResult) {
      throw new Error("Select a Planetary Computer catalog observation before requesting imagery.");
    }
    const workflowId = snapshot.planetaryComputerResult.workflowId;
    const prefix = `pc:${item.collectionId}:`;
    if (!item.id.startsWith(prefix)) {
      throw new Error("The observation ID does not match its catalog collection.");
    }
    const itemId = item.id.slice(prefix.length);
    const requestId = ++latestVisualizationRequest;
    visualizationAbort?.abort();
    const controller = new AbortController();
    visualizationAbort = controller;
    set((state) => ({
      planetaryVisualization: null,
      planetaryVisualizationStatus: "loading",
      planetaryVisualizationError: null,
      layers: new Set([...state.layers].filter(layer => layer !== "selected-imagery")),
    }));
    try {
      const response = await fetch("/api/planetary-computer/visualization", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId, collectionId: item.collectionId, itemId }),
        signal: controller.signal,
      });
      const payload = await response.json() as PlanetaryComputerVisualization & { error?: string };
      if (!response.ok) throw new Error(payload.error || `Imagery verification returned HTTP ${response.status}.`);
      if (requestId !== latestVisualizationRequest) return;
      set((state) => ({
        planetaryVisualization: payload,
        planetaryVisualizationStatus: "ready",
        planetaryVisualizationError: null,
        layers: new Set([...state.layers, "selected-imagery"]),
        opacity: { ...state.opacity, "selected-imagery": state.opacity["selected-imagery"] ?? 75 },
      }));
    } catch (error) {
      if (requestId !== latestVisualizationRequest || controller.signal.aborted) return;
      set({
        planetaryVisualization: null,
        planetaryVisualizationStatus: "error",
        planetaryVisualizationError: error instanceof Error ? error.message : "The catalog item has no verified imagery visualization path.",
      });
    } finally {
      if (visualizationAbort === controller) visualizationAbort = null;
    }
  },
  startSentinel2NDVI: async () => {
    const snapshot = useApp.getState();
    const item = snapshot.planetaryComputerResult?.items.find(observation => observation.id === snapshot.selectedId);
    if (!item || item.collectionId !== "sentinel-2-l2a" || !item.id.startsWith("pc:sentinel-2-l2a:")) {
      throw new Error("Select a loaded Sentinel-2 L2A observation before starting NDVI processing.");
    }
    const geometry = snapshot.aoi?.feature.geometry;
    if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) {
      throw new Error("Draw or select a polygon area of interest before starting NDVI processing.");
    }
    if (snapshot.scientificJob?.status === "queued" || snapshot.scientificJob?.status === "processing") {
      throw new Error("A scientific processing job is already active. Wait for it to finish or cancel it first.");
    }
    if (snapshot.scientificJobSubmitting) {
      throw new Error("A scientific processing job is already being submitted.");
    }
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error("Configure Supabase authentication before starting scientific processing.");
    const itemId = item.id.slice("pc:sentinel-2-l2a:".length);
    if (!/^[A-Za-z0-9._:-]{1,200}$/.test(itemId)) {
      throw new Error("The selected catalog item has an invalid source identifier.");
    }
    set({ scientificJobSubmitting: true, scientificJobError: null });
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Sign in before starting scientific processing.");

      set((state) => ({
        scientificJob: null,
        scientificJobPreviewUrl: null,
        scientificJobRasterUrl: null,
        layers: new Set([...state.layers].filter(layer => layer !== "scientific-result")),
      }));
      const { data, error } = await supabase.rpc("enqueue_sentinel2_ndvi_job", {
        p_item_id: itemId,
        p_aoi_geojson: geometry,
      });
      if (error) throw error;
      if (typeof data !== "string") throw new Error("Supabase returned an invalid scientific job ID.");
      set({
        scientificJob: {
          id: data,
          itemId,
          status: "queued",
          stage: "queued",
          progress: 0,
          errorMessage: null,
          result: null,
          provenance: null,
        },
      });
      scheduleScientificJobPoll(data);
      try {
        await useApp.getState().refreshScientificJob(data);
      } catch (error) {
        set({
          scientificJobError: error instanceof Error ? error.message : "The queued job status could not be loaded.",
        });
      }
    } finally {
      set({ scientificJobSubmitting: false });
    }
  },
  refreshScientificJob: async (jobId) => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error("Supabase authentication is not configured.");
    const { data, error } = await supabase
      .from("scientific_jobs")
      .select("id,item_id,status,stage,progress,error_message,result,provenance")
      .eq("id", jobId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("The scientific job was not found or is no longer available to this account.");
    const job = parseScientificJob(data);
    if (job.status !== "completed" || !job.result) {
      set((state) => state.scientificJob?.id === jobId || !state.scientificJob
        ? { scientificJob: job, scientificJobError: null, scientificJobPreviewUrl: null, scientificJobRasterUrl: null }
        : {});
      return;
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!user) throw new Error("Sign in again to view the completed scientific result.");
    const expectedPreviewPath = `${user.id}/${job.id}/sentinel2-ndvi-preview.png`;
    const expectedRasterPath = `${user.id}/${job.id}/sentinel2-ndvi.tif`;
    if (job.result.previewPath !== expectedPreviewPath || job.result.rasterPath !== expectedRasterPath) {
      throw new Error("The scientific result output paths do not match the signed-in user and job.");
    }
    const [preview, raster] = await Promise.all([
      supabase.storage.from("scientific-results").createSignedUrl(job.result.previewPath, 3600),
      supabase.storage.from("scientific-results").createSignedUrl(job.result.rasterPath, 3600),
    ]);
    if (preview.error) throw preview.error;
    if (raster.error) throw raster.error;
    if (!preview.data.signedUrl || !raster.data.signedUrl) {
      throw new Error("Supabase did not return signed URLs for the scientific outputs.");
    }
    set((state) => state.scientificJob?.id === jobId || !state.scientificJob
      ? {
          scientificJob: job,
          scientificJobPreviewUrl: preview.data.signedUrl,
          scientificJobRasterUrl: raster.data.signedUrl,
          scientificJobError: null,
          layers: new Set([...state.layers, "scientific-result"]),
          opacity: { ...state.opacity, "scientific-result": state.opacity["scientific-result"] ?? 75 },
        }
      : {});
  },
  cancelScientificJob: async (jobId) => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error("Supabase authentication is not configured.");
    const { error } = await supabase.rpc("cancel_scientific_job", { p_job_id: jobId });
    if (error) throw error;
    await useApp.getState().refreshScientificJob(jobId);
  },
  meteomaticsContext: null,
  meteomaticsStatus: "idle",
  meteomaticsError: null,
  locationResult: null,
  locationStatus: "idle",
  locationError: null,
  lookupLocation: async (latitude, longitude) => {
    const requestId = ++latestLocationRequest;
    set((state) => ({
      selectedId: null,
      locationResult: null,
      locationStatus: "loading",
      locationError: null,
      investigation: { ...state.investigation, selectedId: null },
    }));
    try {
      const result = await fetchReverseGeocode(latitude, longitude);
      if (requestId === latestLocationRequest) {
        latestNISARRequest += 1;
        latestPlanetaryComputerRequest += 1;
        latestMeteomaticsRequest += 1;
        latestVisualizationRequest += 1;
        nisarAbort?.abort();
        planetaryComputerAbort?.abort();
        visualizationAbort?.abort();
        const [west, south, east, north] = result.bbox;
        const aoi = { ...rectangleAOI([west, south], [east, north]), name: result.displayName };
        set((state) => ({
          aoi,
          locationResult: result,
          locationStatus: "ready",
          locationError: null,
          selectedId: result.id,
          view: { lat: result.latitude, lng: result.longitude, altitude: viewAltitudeForBounds(result.bbox) },
          lod: lodForAltitude(viewAltitudeForBounds(result.bbox)),
          viewNonce: state.viewNonce + 1,
          planetaryComputerResult: null,
          planetaryComputerStatus: "idle",
          planetaryComputerWorkflowId: null,
          planetaryComputerError: null,
          planetaryVisualization: null,
          planetaryVisualizationStatus: "idle",
          planetaryVisualizationError: null,
          layers: new Set([...state.layers, "search-location"].filter(layer => layer !== "selected-imagery")),
          investigation: { ...state.investigation, selectedId: result.id, region: result.displayName },
        }));
      }
    } catch (error) {
      if (requestId === latestLocationRequest) {
        set({
          locationResult: null,
          locationStatus: "error",
          locationError: error instanceof Error ? error.message : "Reverse geocoding is unavailable.",
        });
      }
    }
  },
  setLocationResult: (result) => {
    latestLocationRequest += 1;
    set({ locationResult: result, locationStatus: result ? "ready" : "idle", locationError: null });
  },
  refreshLiveData: async () => {
    if (useApp.getState().liveDataStatus === "loading") return;
    set((state) => ({
      liveDataStatus: "loading",
      liveDataError: null,
      liveProviderStatus: {
        usgs: { ...state.liveProviderStatus.usgs, status: "loading", error: null },
        eonet: { ...state.liveProviderStatus.eonet, status: "loading", error: null },
      },
    }));
    await fetchLiveEarthData((result) => {
      const key: LiveFeedKey = result.source === "USGS" ? "usgs" : "eonet";
      set((state) => {
        const events = result.status === "ready"
          ? [
              ...state.liveEvents.filter((event) => event.source !== result.source),
              ...result.events,
            ]
          : state.liveEvents;
        const unique = [...new Map(events.map((event) => [event.id, event])).values()];
        const providerStatus = {
          ...state.liveProviderStatus,
          [key]: {
            status: result.status,
            error: result.error,
            updatedAt: result.updatedAt,
            cached: result.cached,
          },
        };
        const statuses = Object.values(providerStatus);
        const hasLoading = statuses.some((provider) => provider.status === "loading");
        const failures = statuses.filter((provider) => provider.status === "error");
        const liveDataStatus = hasLoading
          ? "loading"
          : failures.length === 0
            ? "ready"
            : failures.length < statuses.length
              ? "partial"
              : "error";
        const errors = [
          providerStatus.usgs.error ? `USGS: ${providerStatus.usgs.error}` : null,
          providerStatus.eonet.error ? `NASA EONET: ${providerStatus.eonet.error}` : null,
        ].filter((error): error is string => Boolean(error));
        return {
          liveEvents: unique,
          liveProviderStatus: providerStatus,
          liveDataStatus,
          liveDataUpdatedAt: result.updatedAt ?? state.liveDataUpdatedAt,
          liveDataError: errors.length ? errors.join(" ") : null,
        };
      });
    });
  },
  refreshPlanetaryComputer: async (workflowId) => {
    const requestId = ++latestPlanetaryComputerRequest;
    planetaryComputerAbort?.abort();
    const controller = new AbortController();
    planetaryComputerAbort = controller;
    const snapshot = useApp.getState();
    const today = dateKey(new Date());
    const requestedEnd = snapshot.time.current < snapshot.time.end ? snapshot.time.current : snapshot.time.end;
    const endDate = requestedEnd > today ? today : requestedEnd;
    const startDate = snapshot.time.start > endDate ? endDate : snapshot.time.start;
    const geometry = snapshot.aoi?.feature.geometry ?? null;
    set((state) => {
      return {
        planetaryComputerStatus: "loading",
        planetaryComputerWorkflowId: workflowId,
        planetaryComputerError: null,
        planetaryVisualization: null,
        planetaryVisualizationStatus: "idle",
        planetaryVisualizationError: null,
        layers: new Set([...state.layers, "planetary-observations"].filter(layer => layer !== "selected-imagery")),
      };
    });
    try {
      const response = await fetch("/api/planetary-computer/search", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId, startDate, endDate, geometry }),
        signal: controller.signal,
      });
      const payload = await response.json() as PlanetaryComputerSearchResult & { error?: string };
      if (!response.ok) throw new Error(payload.error || `Planetary Computer search returned HTTP ${response.status}.`);
      if (requestId !== latestPlanetaryComputerRequest) return;
      set({
        planetaryComputerResult: payload,
        planetaryComputerStatus: payload.warnings.length ? "partial" : "ready",
        planetaryComputerWorkflowId: workflowId,
        planetaryComputerError: payload.warnings.length ? payload.warnings.join(" ") : null,
      });
    } catch (error) {
      if (requestId !== latestPlanetaryComputerRequest || controller.signal.aborted) return;
      set({
        planetaryComputerStatus: "error",
        planetaryComputerWorkflowId: workflowId,
        planetaryComputerError: error instanceof Error ? error.message : "Planetary Computer search failed.",
      });
    } finally {
      if (planetaryComputerAbort === controller) planetaryComputerAbort = null;
    }
  },
  refreshMeteomatics: async (center) => {
    const requestId = ++latestMeteomaticsRequest;
    set({ meteomaticsStatus: "loading", meteomaticsError: null });
    try {
      const params = new URLSearchParams();
      if (center) {
        params.set("lat", String(center.lat));
        params.set("lng", String(center.lng));
      }
      const query = params.toString() ? `?${params.toString()}` : "";
      const response = await fetch(`/api/meteomatics/context${query}`, {
        headers: { Accept: "application/json" },
      });
      const payload = await response.json() as MeteomaticsContext & { error?: string };
      if (!response.ok) throw new Error(payload.error || `Meteomatics returned HTTP ${response.status}.`);
      if (requestId !== latestMeteomaticsRequest) return;
      set({
        meteomaticsContext: payload,
        meteomaticsStatus: payload.status,
        meteomaticsError: payload.warning,
      });
    } catch (error) {
      if (requestId !== latestMeteomaticsRequest) return;
      set({
        meteomaticsStatus: "error",
        meteomaticsError: error instanceof Error ? error.message : "Meteomatics weather context failed.",
      });
    }
  },
  nisarCollections: [],
  nisarCollectionHits: 0,
  nisarProductCollections: [],
  nisarGranules: [],
  nisarGranuleHits: 0,
  nisarGranuleHitsByProduct: {},
  nisarGranuleStatusByProduct: {},
  nisarPage: 0,
  nisarHasMore: false,
  nisarSelectedProductCodes: DEFAULT_NISAR_PRODUCTS,
  setNISARProductSelection: (productCodes) => {
    const selected = [...new Set(productCodes.map(code => code.toUpperCase()).filter(isNISARCoverageProductCode))];
    if (selected.length) set({ nisarSelectedProductCodes: selected });
  },
  nisarStatus: "idle",
  nisarUpdatedAt: null,
  nisarError: null,
  refreshNISARData: async (requestedProducts, requestedPage = 1, append = false) => {
    const initial = useApp.getState();
    const productCodes = [...new Set((requestedProducts ?? initial.nisarSelectedProductCodes).map(code => code.toUpperCase()))]
      .filter(isNISARCoverageProductCode);
    const snapshot = initial;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayKey = dateKey(today);
    const requestedEnd = snapshot.time.current < snapshot.time.end ? snapshot.time.current : snapshot.time.end;
    const endDate = requestedEnd > todayKey ? todayKey : requestedEnd;
    const startDate = snapshot.time.start > endDate ? endDate : snapshot.time.start;
    const aoiBounds = snapshot.aoi?.bounds;
    const bounds = aoiBounds && aoiBounds.length === 4 && aoiBounds.every(Number.isFinite)
      ? { west: aoiBounds[0]!, south: aoiBounds[1]!, east: aoiBounds[2]!, north: aoiBounds[3]! }
      : null;

    if (!productCodes.length) {
      ++latestNISARRequest;
      nisarAbort?.abort();
      const controller = new AbortController();
      nisarAbort = controller;
      const layers = new Set(initial.layers);
      for (const code of NISAR_COVERAGE_PRODUCT_CODES) layers.delete(`prod-${code}`);
      set({ nisarSelectedProductCodes: productCodes, nisarStatus: "loading", nisarError: null, layers });
      set({
        nisarGranules: [],
        nisarGranuleHits: 0,
        nisarGranuleHitsByProduct: {},
        nisarGranuleStatusByProduct: {},
        nisarPage: 0,
        nisarHasMore: false,
        nisarStatus: "ready",
        nisarUpdatedAt: new Date().toISOString(),
        nisarError: null,
      });
      if (nisarAbort === controller) nisarAbort = null;
      return;
    }

    const requestKey = JSON.stringify({ startDate, endDate, productCodes, bounds, page: requestedPage });
    if (nisarRequestKey === requestKey && nisarRequestPromise && nisarAbort && !nisarAbort.signal.aborted) {
      return nisarRequestPromise;
    }

    const requestId = ++latestNISARRequest;
    nisarAbort?.abort();
    const controller = new AbortController();
    nisarAbort = controller;
    const layers = new Set(initial.layers);
    for (const code of NISAR_COVERAGE_PRODUCT_CODES) {
      if (productCodes.includes(code)) layers.add(`prod-${code}`);
      else layers.delete(`prod-${code}`);
    }
    set({ nisarSelectedProductCodes: productCodes, nisarStatus: "loading", nisarError: null, layers });
    nisarRequestKey = requestKey;

    const requestPromise = Promise.resolve().then(async () => {
      try {
        const params = new URLSearchParams({
          startDate,
          endDate,
          products: productCodes.join(","),
          page: String(requestedPage),
        });
        if (bounds) {
          params.set("west", String(bounds.west));
          params.set("south", String(bounds.south));
          params.set("east", String(bounds.east));
          params.set("north", String(bounds.north));
        }
        const response = await fetch(`/api/nisar/coverage?${params.toString()}`, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const payload = await response.json() as NISARCoverageResult & { error?: string };
        if (!response.ok) throw new Error(payload.error || `NISAR catalog API returned HTTP ${response.status}.`);
        const result = payload;
        if (requestId !== latestNISARRequest) return;
        set((state) => {
          const granules = append
            ? [...new Map([...state.nisarGranules, ...result.granules].map((granule) => [granule.id, granule])).values()]
            : result.granules;
          granules.sort((a, b) => (Date.parse(b.startDate || "") || 0) - (Date.parse(a.startDate || "") || 0));
          return {
            nisarCollections: result.collections,
            nisarCollectionHits: result.collectionHits,
            nisarProductCollections: result.productCollections,
            nisarGranules: granules,
            nisarGranuleHits: result.granuleHits,
            nisarGranuleHitsByProduct: result.granuleHitsByProduct ?? {},
            nisarGranuleStatusByProduct: result.granuleStatusByProduct ?? {},
            nisarPage: result.page,
            nisarHasMore: result.hasMore,
            nisarStatus: result.warnings.length ? "partial" : "ready",
            nisarUpdatedAt: new Date().toISOString(),
            nisarError: result.warnings.length ? result.warnings.join(" ") : null,
          };
        });
      } catch (error) {
        if (requestId !== latestNISARRequest || controller.signal.aborted) return;
        set((state) => ({
          nisarStatus: state.nisarGranules.length ? "partial" : "error",
          nisarError: error instanceof Error ? error.message : "Real NISAR catalog search failed.",
        }));
      } finally {
        if (nisarAbort === controller) nisarAbort = null;
        if (nisarRequestPromise === requestPromise) {
          nisarRequestKey = null;
          nisarRequestPromise = null;
        }
      }
    });
    nisarRequestPromise = requestPromise;
    return requestPromise;
  },
  setAOI: (aoi) => {
    latestNISARRequest += 1;
    latestPlanetaryComputerRequest += 1;
    latestMeteomaticsRequest += 1;
    latestVisualizationRequest += 1;
    nisarAbort?.abort();
    planetaryComputerAbort?.abort();
    visualizationAbort?.abort();
    set((state) => {
      // Drawing an AOI after selecting a Sentinel-2 scene must not discard
      // that scene: NDVI submission needs both the selected item and polygon.
      const keepSelectedObservation = Boolean(
        state.selectedId &&
        state.planetaryComputerResult?.items.some(item => item.id === state.selectedId),
      );
      return {
        aoi,
        drawTool: null,
        drawingPoints: [],
        drawingError: null,
        selectedId: keepSelectedObservation ? state.selectedId : null,
        locationResult: null,
        locationStatus: "idle",
        locationError: null,
        investigation: {
          ...state.investigation,
          selectedId: keepSelectedObservation ? state.selectedId : null,
        },
        nisarStatus: state.nisarStatus === "loading" ? "idle" : state.nisarStatus,
        planetaryComputerResult: keepSelectedObservation ? state.planetaryComputerResult : null,
        planetaryComputerStatus: keepSelectedObservation ? state.planetaryComputerStatus : "idle",
        planetaryComputerWorkflowId: keepSelectedObservation ? state.planetaryComputerWorkflowId : null,
        planetaryComputerError: keepSelectedObservation ? state.planetaryComputerError : null,
        planetaryVisualization: null,
        planetaryVisualizationStatus: "idle",
        planetaryVisualizationError: null,
        layers: new Set([...state.layers].filter(layer => layer !== "selected-imagery")),
        meteomaticsContext: null,
        meteomaticsStatus: state.meteomaticsContext?.configured ? "configured" : "idle",
        meteomaticsError: null,
      };
    });
  },
  addAnalysis: (result) => set(state => ({ analyses: [...state.analyses,result], investigation: {...state.investigation,lastAnalysisId:result.id} })),
  sidebarCollapsed: true,
  analysisOpen: false,
  mode: "intelligence",
  activeIntelligenceWorkflowId: "wildfire-monitoring",
  earthMode: "3d",
  lod: "global",
  advanced: false,
  layers: new Set([
    "nisar-coverage",
    "planetary-observations",
    ...DEFAULT_NISAR_PRODUCTS.map((code) => `prod-${code}`),
  ]),
  opacity: {},
  selectedId: null,
  hoveredId: null,
  view: { lat: 0, lng: 0, altitude: 2.4 },
  viewNonce: 0,
  time: INITIAL_TIME,
  monthIndex: 9,
  playing: false,
  playbackSpeed: 1,
  filter: DEFAULT_FILTER,
  aiActive: false,
  aiMessages: [],
  agentInvestigation: null,
  agentFindings: [],
  aiSteps: null,
  aiTitle: null,
  onboarded: true,
  guideStep: 0,
  investigation: { region: null, selectedId: null, types: null, comparison: null, lastAnalysisId: null },
  setSidebar: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setAnalysisOpen: (analysisOpen) => set({ analysisOpen }),
  setMode: (mode) => set({ mode }),
  setActiveIntelligenceWorkflow: (activeIntelligenceWorkflowId) => set({ activeIntelligenceWorkflowId }),
  setEarthMode: (earthMode) => set({ earthMode }),
  setAdvanced: (advanced) => set({ advanced }),
  toggleLayer: (id, on) => set((state) => {
    const layers = new Set(state.layers);
    const enabled = on ?? !layers.has(id);
    if (enabled) layers.add(id); else layers.delete(id);
    return { layers };
  }),
  setOpacity: (id, value) => set((state) => ({ opacity: { ...state.opacity, [id]: value } })),
  select: (id) => set((state) => {
    if (!id) {
      latestLocationRequest += 1;
      return {
        selectedId: null,
        locationResult: null,
        locationStatus: "idle",
        locationError: null,
        investigation: { ...state.investigation, selectedId: null },
      };
    }
    latestLocationRequest += 1;
    const location = state.locationResult?.id === id ? state.locationResult : null;
    if (location) {
      const altitude = viewAltitudeForBounds(location.bbox);
      return {
        selectedId: id,
        view: { lat: location.latitude, lng: location.longitude, altitude },
        lod: lodForAltitude(altitude),
        viewNonce: state.viewNonce + 1,
        investigation: { ...state.investigation, selectedId: id, region: location.displayName },
      };
    }
    const agentFinding = state.agentFindings.find((finding) => finding.id === id);
    if (agentFinding) {
      return {
        selectedId: id,
        view: { lat: agentFinding.latitude, lng: agentFinding.longitude, altitude: 0.045 },
        lod: lodForAltitude(0.045),
        viewNonce: state.viewNonce + 1,
        investigation: { ...state.investigation, selectedId: id, region: agentFinding.name },
      };
    }
    const event = state.liveEvents.find((item) => item.id === id);
    if (!event) {
      const observation = state.planetaryComputerResult?.items.find((item) => item.id === id);
      if (observation) {
        const bounds = observation.bbox ?? geometryBounds(observation.geometry);
        const lat = bounds ? (bounds[1] + bounds[3]) / 2 : observation.geometry?.type === "Point"
          ? observation.geometry.coordinates[1]!
          : state.view.lat;
        const lng = bounds ? (bounds[0] + bounds[2]) / 2 : observation.geometry?.type === "Point"
          ? observation.geometry.coordinates[0]!
          : state.view.lng;
        const day = observation.datetime?.slice(0, 10);
        const safeDay = day && day > dateKey(new Date()) ? dateKey(new Date()) : day;
        const start = safeDay && safeDay < state.time.start ? safeDay : state.time.start;
        const end = safeDay && safeDay > state.time.end ? safeDay : state.time.end;
        return {
          selectedId: id,
          locationResult: null,
          locationStatus: "idle",
          locationError: null,
          view: { lat, lng, altitude: 0.12 },
          lod: lodForAltitude(0.12),
          viewNonce: state.viewNonce + 1,
          monthIndex: safeDay ? new Date(safeDay).getUTCMonth() : state.monthIndex,
          time: { ...state.time, start, end, current: safeDay ?? state.time.current },
          investigation: { ...state.investigation, selectedId: id, region: "Planetary Computer catalog observation", types: null },
        };
      }
      const granule = state.nisarGranules.find((item) => item.id === id);
      if (!granule) return {
        selectedId: id,
        locationResult: null,
        locationStatus: "idle",
        locationError: null,
        investigation: { ...state.investigation, selectedId: id },
      };
      const bounds = granule.bounds;
      const footprint = granule.footprint ?? [];
      const hasFootprint = footprint.length >= 3;
      const lat = bounds
        ? (bounds.south + bounds.north) / 2
        : hasFootprint
          ? footprint.reduce((sum, point) => sum + point[1], 0) / footprint.length
          : state.view.lat;
      const lng = bounds
        ? (bounds.west + bounds.east) / 2
        : hasFootprint
          ? footprint.reduce((sum, point) => sum + point[0], 0) / footprint.length
          : state.view.lng;
      const eventDay = (granule.startDate || state.time.current).slice(0, 10);
      const safeDay = eventDay > dateKey(new Date()) ? dateKey(new Date()) : eventDay;
      const start = safeDay < state.time.start ? safeDay : state.time.start;
      const end = safeDay > state.time.end ? safeDay : state.time.end;
      return {
        selectedId: id,
        locationResult: null,
        locationStatus: "idle",
        locationError: null,
        view: { lat: Number.isFinite(lat) ? lat : state.view.lat, lng: Number.isFinite(lng) ? lng : state.view.lng, altitude: 0.12 },
        lod: lodForAltitude(0.12),
        viewNonce: state.viewNonce + 1,
        monthIndex: new Date(safeDay).getUTCMonth(),
        time: { ...state.time, start, end, current: safeDay },
        investigation: { ...state.investigation, selectedId: id, region: "NISAR acquisition coverage", types: null },
      };
    }
    const eventDay = event.date.slice(0, 10);
    const monthIndex = new Date(eventDay).getUTCMonth();
    const bounds = geometryBounds(event.geometry ?? null);
    const altitude = viewAltitudeForBounds(bounds);
    return {
      selectedId: id,
      locationResult: null,
      locationStatus: "idle",
      locationError: null,
      view: { lat: event.lat, lng: event.lng, altitude },
      lod: lodForAltitude(altitude),
      viewNonce: state.viewNonce + 1,
      monthIndex,
      time: {
        ...state.time,
        start: eventDay < state.time.start ? eventDay : state.time.start,
        end: eventDay > state.time.end ? eventDay : state.time.end,
        current: eventDay,
      },
      investigation: { ...state.investigation, selectedId: id, region: event.region || event.country, types: [event.type] },
    };
  }),
  setHovered: (hoveredId) => set({ hoveredId }),
  flyTo: (value) => set((state) => {
    const view = { altitude: 1.2, ...value };
    return { view, lod: lodForAltitude(view.altitude), viewNonce: state.viewNonce + 1 };
  }),
  syncView: (view) => set({ view, lod: lodForAltitude(view.altitude) }),
  setMonth: (monthIndex) => {
    latestNISARRequest += 1;
    latestPlanetaryComputerRequest += 1;
    nisarAbort?.abort();
    planetaryComputerAbort?.abort();
    set((state) => {
    const safeMonth = Math.min(11, Math.max(0, monthIndex));
    const year = Number(state.time.current.slice(0, 4));
    const day = Number(state.time.current.slice(8, 10));
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const maxMonth = year === today.getUTCFullYear() ? today.getUTCMonth() : 11;
    const month = Math.min(safeMonth, maxMonth);
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const requested = `${year}-${String(month + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
    const end = state.time.end > dateKey(today) ? dateKey(today) : state.time.end;
    const current = requested < state.time.start ? state.time.start : requested > end ? end : requested;
    return {
      monthIndex: new Date(current).getUTCMonth(),
      time: { ...state.time, end, current },
      nisarStatus: state.nisarStatus === "loading" ? "idle" : state.nisarStatus,
      planetaryComputerStatus: state.planetaryComputerStatus === "loading" ? "idle" : state.planetaryComputerStatus,
    };
    });
  },
  setCurrentDate: (current) => {
    latestNISARRequest += 1;
    latestPlanetaryComputerRequest += 1;
    nisarAbort?.abort();
    planetaryComputerAbort?.abort();
    set((state) => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const end = state.time.end > dateKey(today) ? dateKey(today) : state.time.end;
    const safeCurrent = current < state.time.start ? state.time.start : current > end ? end : current;
    return {
      time: { ...state.time, end, current: safeCurrent },
      monthIndex: new Date(safeCurrent).getUTCMonth(),
      nisarStatus: state.nisarStatus === "loading" ? "idle" : state.nisarStatus,
      planetaryComputerStatus: state.planetaryComputerStatus === "loading" ? "idle" : state.planetaryComputerStatus,
    };
    });
  },
  setTimeRange: (range) => {
    latestNISARRequest += 1;
    latestPlanetaryComputerRequest += 1;
    nisarAbort?.abort();
    planetaryComputerAbort?.abort();
    set((state) => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayKey = dateKey(today);
    const end = range.end > todayKey ? todayKey : range.end;
    const start = range.start > end ? end : range.start;
    const current = state.time.current < start ? start : state.time.current > end ? end : state.time.current;
    return {
      time: { ...state.time, start, end, current },
      monthIndex: new Date(current).getUTCMonth(),
      nisarStatus: state.nisarStatus === "loading" ? "idle" : state.nisarStatus,
      planetaryComputerStatus: state.planetaryComputerStatus === "loading" ? "idle" : state.planetaryComputerStatus,
    };
    });
  },
  setPlaying: (playing) => set({ playing }),
  setPlaybackSpeed: (playbackSpeed) => set({ playbackSpeed }),
  setFilter: (value) => set((state) => {
    const filter = { ...state.filter, ...value };
    return { filter, investigation: { ...state.investigation, region: filter.region, types: filter.types } };
  }),
  resetFilter: () => set((state) => ({ filter: DEFAULT_FILTER, investigation: { ...state.investigation, region: null, types: null } })),
  setAIActive: (aiActive) => set({ aiActive }),
  setAgentFindings: (agentFindings) => set({ agentFindings }),
  setAgentInvestigation: (agentInvestigation) => set({
    agentInvestigation,
    agentFindings: agentInvestigation.findings,
  }),
  pushMessage: (message) => {
    const aiMessages = [...get().aiMessages, message].slice(-MAX_STORED_ASSISTANT_MESSAGES);
    set({ aiMessages });
    persistAssistantMessages(aiMessages);
  },
  restoreAIMessages: (aiMessages) => set((state) =>
    state.aiMessages.length ? {} : { aiMessages, aiActive: aiMessages.length > 0 },
  ),
  clearAIMessages: () => {
    set({ aiMessages: [], aiActive: false, agentInvestigation: null, agentFindings: [] });
    if (typeof window === "undefined") return;
    try {
      localStorage.removeItem(ASSISTANT_CONVERSATION_KEY);
    } catch (error) {
      console.warn("Could not clear the saved Third Eye conversation.", error);
    }
  },
  setSteps: (aiTitle, aiSteps) => set({ aiTitle, aiSteps }),
  setOnboarded: (onboarded) => set({ onboarded }),
  setGuideStep: (guideStep) => set({ guideStep }),
  setInvestigation: (value) => set((state) => ({ investigation: { ...state.investigation, ...value } })),
}));

export function visibleEvents(state: Pick<AppState, "layers" | "filter" | "time" | "lod"> & Partial<Pick<AppState, "monthIndex">>, all: readonly EarthEventRecord[] = EARTH_EVENTS) {
  const current = new Date(state.time.current).getTime();
  return all.filter((event) => {
    if (!state.layers.has(event.type)) return false;
    if (state.filter.types && !state.filter.types.includes(event.type)) return false;
    if (state.filter.region && !`${event.region} ${event.country}`.toLowerCase().includes(state.filter.region.toLowerCase())) return false;
    if (new Date(event.validFrom).getTime() > current) return false;
    const band = severityBand(event.severity);
    if (state.filter.severity !== "all" && band !== state.filter.severity) return false;
    if (state.filter.significance === "high" && !(event.severity >= 0.7 && event.confidence === "High")) return false;
    if (state.filter.significance === "moderate+" && event.severity < 0.45) return false;
    if (state.filter.confidence === "high" && event.confidence !== "High") return false;
    if (state.filter.confidence === "moderate+" && confidenceRank[event.confidence] < 2) return false;
    if (state.filter.evidence !== "all" && event.evidenceClass !== state.filter.evidence) return false;
    if (event.date < state.time.start || event.date > state.time.end) return false;
    return true;
  });
}