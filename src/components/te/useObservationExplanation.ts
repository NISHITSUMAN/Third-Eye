import { useCallback, useEffect, useMemo, useState } from "react";
import { geometryBounds, type GeographicBounds } from "@/lib/geographic-results";
import { useApp } from "@/lib/store";

export interface ObservationExplanationTarget {
  id: string;
  kind: "nisar" | "satellite-observation" | "public-event";
  source: string;
  title: string;
  product: string | null;
  date: string | null;
  coordinates: { lat: number; lng: number } | null;
  bounds: GeographicBounds | null;
  metadata: Record<string, unknown>;
}

export interface ObservationRelatedRecord {
  id: string;
  kind: string;
  source: string;
  title: string;
  product: string | null;
  date: string | null;
}

interface RelatedRecord extends ObservationRelatedRecord {
  metadata: Record<string, unknown>;
}

interface ExplanationState {
  key: string | null;
  status: "idle" | "loading" | "ready" | "error";
  explanation: string | null;
  error: string | null;
  relatedRecordCount: number;
  relatedRecordsAnalyzed: number;
  relatedRecords: ObservationRelatedRecord[];
}

type ObservationDataState = Pick<
  ReturnType<typeof useApp.getState>,
  "nisarGranules" | "planetaryComputerResult" | "liveEvents"
>;

const explanationCache = new Map<string, {
  explanation: string;
  relatedRecordCount: number;
  relatedRecordsAnalyzed: number;
  relatedRecords: ObservationRelatedRecord[];
}>();

function boundsContain(bounds: GeographicBounds, lat: number, lng: number) {
  return lng >= bounds[0] && lng <= bounds[2] && lat >= bounds[1] && lat <= bounds[3];
}

function boundsOverlap(a: GeographicBounds, b: GeographicBounds) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function positionsBounds(positions: Array<[number, number]> | null): GeographicBounds | null {
  if (!positions?.length) return null;
  const lngs = positions.map(([lng]) => lng).filter(Number.isFinite);
  const lats = positions.map(([, lat]) => lat).filter(Number.isFinite);
  if (!lngs.length || !lats.length) return null;
  const bounds: GeographicBounds = [
    Math.min(...lngs),
    Math.min(...lats),
    Math.max(...lngs),
    Math.max(...lats),
  ];
  return bounds[0] < bounds[2] && bounds[1] < bounds[3] ? bounds : null;
}

function isRelated(
  target: ObservationExplanationTarget,
  candidateBounds: GeographicBounds | null,
  candidatePoint: { lat: number; lng: number } | null,
) {
  if (target.bounds && candidateBounds) return boundsOverlap(target.bounds, candidateBounds);
  if (target.bounds && candidatePoint) return boundsContain(target.bounds, candidatePoint.lat, candidatePoint.lng);
  if (target.coordinates && candidateBounds) {
    return boundsContain(candidateBounds, target.coordinates.lat, target.coordinates.lng);
  }
  return false;
}

function relatedRecordsFor(target: ObservationExplanationTarget, state: ObservationDataState): RelatedRecord[] {
  const matches: RelatedRecord[] = [];
  const add = (
    id: string,
    bounds: GeographicBounds | null,
    point: { lat: number; lng: number } | null,
    record: RelatedRecord,
  ) => {
    if (id !== target.id && isRelated(target, bounds, point)) matches.push(record);
  };

  for (const granule of state.nisarGranules) {
    const bounds = granule.bounds
      ? [granule.bounds.west, granule.bounds.south, granule.bounds.east, granule.bounds.north] as GeographicBounds
      : positionsBounds(granule.footprint);
    add(granule.id, bounds, null, {
      id: granule.id,
      kind: "NISAR catalog record",
      source: `NASA CMR / ${granule.producer || "NISAR"}`,
      title: granule.title,
      product: granule.productCode,
      date: granule.startDate,
      metadata: {
        maturity: granule.maturity,
        productionConfiguration: granule.productionConfiguration,
        polarization: granule.polarization,
        platform: granule.platform,
        instrument: granule.instrument,
        bounds,
      },
    });
  }

  const planetaryItems = state.planetaryComputerResult?.items ?? [];
  for (const item of planetaryItems) {
    const bounds = item.bbox && item.bbox.length === 4
      ? item.bbox as GeographicBounds
      : geometryBounds(item.geometry ?? null);
    const point = item.geometry?.type === "Point"
      ? { lat: item.geometry.coordinates[1]!, lng: item.geometry.coordinates[0]! }
      : null;
    add(item.id, bounds, point, {
      id: item.id,
      kind: "Satellite catalog record",
      source: `Microsoft Planetary Computer / ${item.collectionLabel}`,
      title: item.title,
      product: item.collectionId,
      date: item.datetime,
      metadata: {
        platform: item.platform,
        instruments: item.instruments,
        collectionId: item.collectionId,
        bounds,
      },
    });
  }

  for (const event of state.liveEvents) {
    const bounds = geometryBounds(event.geometry ?? null);
    add(event.id, bounds, { lat: event.lat, lng: event.lng }, {
      id: event.id,
      kind: "Source-reported public event",
      source: event.source,
      title: event.title,
      product: event.type,
      date: event.date,
      metadata: {
        region: event.region,
        metric: event.metric,
        metricLabel: event.metricLabel,
        summary: event.summary,
        reportedCoordinates: { lat: event.lat, lng: event.lng },
      },
    });
  }

  const targetTime = target.date ? Date.parse(target.date) : Number.NaN;
  matches.sort((a, b) => {
    const aTime = a.date ? Date.parse(a.date) : Number.NaN;
    const bTime = b.date ? Date.parse(b.date) : Number.NaN;
    const aIsPrior = Number.isFinite(targetTime) && Number.isFinite(aTime) && aTime < targetTime;
    const bIsPrior = Number.isFinite(targetTime) && Number.isFinite(bTime) && bTime < targetTime;
    if (aIsPrior !== bIsPrior) return aIsPrior ? -1 : 1;
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  });
  return matches;
}

function compactMetadata(value: unknown, depth = 0, budget = { nodes: 180, stringLimit: 400 }): unknown {
  budget.nodes--;
  if (budget.nodes < 0 || depth > 5) return "[additional fields omitted]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, budget.stringLimit);
  if (Array.isArray(value)) return value.slice(0, 16).map(item => compactMetadata(item, depth + 1, budget));
  if (!value || typeof value !== "object") return null;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value).slice(0, 32)) {
    if (/^(assets|links|geometry)$/i.test(key)) continue;
    result[key.slice(0, 80)] = compactMetadata(child, depth + 1, budget);
  }
  return result;
}

function requestPayload(target: ObservationExplanationTarget, related: RelatedRecord[]) {
  const records = related.slice(0, 35);
  const observation = {
    ...target,
    metadata: compactMetadata(target.metadata),
    relatedRecords: records.map(({ id: _id, ...item }) => ({
      ...item,
      metadata: compactMetadata(item.metadata, 0, { nodes: 36, stringLimit: 400 }),
    })),
    relatedRecordCount: related.length,
  };
  let serialized = JSON.stringify({ operation: "explain_observation", observation });
  while (new TextEncoder().encode(serialized).byteLength > 10_500 && observation.relatedRecords.length) {
    observation.relatedRecords.pop();
    serialized = JSON.stringify({ operation: "explain_observation", observation });
  }
  for (const [nodes, stringLimit] of [[120, 160], [60, 80], [30, 40]] as const) {
    if (new TextEncoder().encode(serialized).byteLength <= 10_500) break;
    observation.metadata = compactMetadata(target.metadata, 0, { nodes, stringLimit });
    serialized = JSON.stringify({ operation: "explain_observation", observation });
  }
  return {
    serialized,
    relatedRecordCount: related.length,
    relatedRecordsAnalyzed: observation.relatedRecords.length,
    relatedRecords: records.slice(0, observation.relatedRecords.length).map(({
      id,
      kind,
      source,
      title,
      product,
      date,
    }) => ({ id, kind, source, title, product, date })),
  };
}

export function useObservationExplanation(target: ObservationExplanationTarget | null) {
  const nisarGranules = useApp(state => state.nisarGranules);
  const planetaryComputerResult = useApp(state => state.planetaryComputerResult);
  const liveEvents = useApp(state => state.liveEvents);
  const related = useMemo(
    () => target ? relatedRecordsFor(target, { nisarGranules, planetaryComputerResult, liveEvents }) : [],
    [liveEvents, nisarGranules, planetaryComputerResult, target],
  );
  const request = useMemo(
    () => target ? requestPayload(target, related) : null,
    [related, target],
  );
  const [state, setState] = useState<ExplanationState>({
    key: null,
    status: "idle",
    explanation: null,
    error: null,
    relatedRecordCount: 0,
    relatedRecordsAnalyzed: 0,
    relatedRecords: [],
  });
  const [attempt, setAttempt] = useState(0);
  const recordSignature = related.slice(0, 35).map(record => record.id).join(",");
  const key = target
    ? `${target.kind}:${target.id}:${target.date ?? ""}:${target.product ?? ""}:${related.length}:${recordSignature}`
    : null;
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    if (!target || !key || !request) {
      setState({
        key: null,
        status: "idle",
        explanation: null,
        error: null,
        relatedRecordCount: 0,
        relatedRecordsAnalyzed: 0,
        relatedRecords: [],
      });
      return;
    }
    const cached = explanationCache.get(key);
    if (cached) {
      setState({ key, status: "ready", ...cached, error: null });
      return;
    }

    const controller = new AbortController();
    setState({
      key,
      status: "loading",
      explanation: null,
      error: null,
      relatedRecordCount: request.relatedRecordCount,
      relatedRecordsAnalyzed: request.relatedRecordsAnalyzed,
      relatedRecords: request.relatedRecords,
    });

    void fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: request.serialized,
      signal: controller.signal,
    }).then(async response => {
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("The AI service returned an invalid response.");
      }
      const result = payload as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : `AI explanation failed (HTTP ${response.status}).`);
      if (typeof result.explanation !== "string" || !result.explanation.trim()) {
        throw new Error("The AI service returned an empty explanation.");
      }
      if (controller.signal.aborted) return;
      const explanation = result.explanation.trim();
      const relatedRecordCount = typeof result.relatedRecordCount === "number" ? result.relatedRecordCount : request.relatedRecordCount;
      const relatedRecordsAnalyzed = request.relatedRecordsAnalyzed;
      if (explanationCache.size >= 128) {
        const oldestKey = explanationCache.keys().next().value;
        if (oldestKey) explanationCache.delete(oldestKey);
      }
      const cachedExplanation = {
        explanation,
        relatedRecordCount,
        relatedRecordsAnalyzed,
        relatedRecords: request.relatedRecords,
      };
      explanationCache.set(key, cachedExplanation);
      setState({ key, status: "ready", error: null, ...cachedExplanation });
    }).catch(error => {
      if (controller.signal.aborted) return;
      setState({
        key,
        status: "error",
        explanation: null,
        error: error instanceof Error ? error.message : "The AI explanation could not be loaded.",
        relatedRecordCount: request.relatedRecordCount,
        relatedRecordsAnalyzed: request.relatedRecordsAnalyzed,
        relatedRecords: request.relatedRecords,
      });
    });

    return () => controller.abort();
  }, [attempt, key, request, target]);

  if (!target || !key) {
    return {
      status: "idle" as const,
      explanation: null,
      error: null,
      relatedRecordCount: 0,
      relatedRecordsAnalyzed: 0,
      relatedRecords: [],
      retry,
    };
  }
  if (state.key !== key) {
    return {
      status: "loading" as const,
      explanation: null,
      error: null,
      relatedRecordCount: request?.relatedRecordCount ?? 0,
      relatedRecordsAnalyzed: request?.relatedRecordsAnalyzed ?? 0,
      relatedRecords: request?.relatedRecords ?? [],
      retry,
    };
  }
  return { ...state, retry };
}
