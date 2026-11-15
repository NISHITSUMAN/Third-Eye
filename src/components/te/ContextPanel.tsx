import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { useApp } from "@/lib/store";
import { formatCoord } from "@/lib/earth-vocabulary";
import { geometryBounds, type GeographicBounds } from "@/lib/geographic-results";
import type { LiveEarthEvent } from "@/lib/live-data";
import type { NISARGranule } from "@/lib/nasa-cmr";
import type { PlanetaryObservation } from "@/lib/planetary-computer";
import { ObservationDetails } from "./ObservationDetails";
import { formatDate } from "./observation-format";
import { getNISARObservationExplanation } from "@/lib/observation-explanations";
import { NISAR_PRODUCTS } from "@/lib/sar-registry";
import { LogoMark } from "./Logo";
import { useObservationExplanation, type ObservationExplanationTarget } from "./useObservationExplanation";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function firstDate(source: Record<string, unknown> | undefined, names: readonly string[]): string | null {
  if (!source) return null;
  for (const name of names) {
    const value = source[name];
    if (typeof value === "string" && Number.isFinite(Date.parse(value))) return formatDate(value);
  }
  return null;
}

function namedLocation(source: Record<string, unknown> | undefined): string | null {
  if (!source) return null;
  const wanted = new Set(["country", "countryname", "country_name", "region", "regionname", "region_name", "place", "locationname"]);
  const visit = (value: unknown): string | null => {
    if (Array.isArray(value)) {
      for (const child of value) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    }
    if (!isRecord(value)) return null;
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (wanted.has(normalizedKey)) {
        if (typeof child === "string" && child.trim()) return child.trim();
        if (Array.isArray(child)) {
          const names = child.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
          if (names.length) return names.join(", ");
        }
      }
      const nested = visit(child);
      if (nested) return nested;
    }
    return null;
  };
  return visit(source);
}

function planetaryExplanation(collectionId: string, platform: string | null) {
  const platformName = platform ? ` The catalog reports the platform as ${platform}.` : "";
  if (collectionId === "sentinel-1-rtc") {
    return {
      explanation: `A Sentinel-1 radar observation from the Planetary Computer catalog. The collection contains terrain-corrected radar imagery; the record shown here does not indicate a flood or other detected change.${platformName}`,
      applications: ["Radar backscatter and surface-change research", "Supporting flood and land-monitoring studies"],
    };
  }
  if (collectionId === "sentinel-2-l2a") {
    return {
      explanation: `A Sentinel-2 Level-2A multispectral optical image catalog record. It identifies an image acquisition and footprint; Third Eye has not analyzed its pixels.${platformName}`,
      applications: ["Vegetation and land-cover research", "Environmental monitoring using multispectral imagery"],
    };
  }
  if (collectionId === "landsat-c2-l2") {
    return {
      explanation: `A Landsat Collection 2 Level-2 surface-observation catalog record. It identifies an image and its footprint; no change analysis has been performed here.${platformName}`,
      applications: ["Land-surface and vegetation research", "Comparing observations across dates"],
    };
  }
  if (collectionId === "modis-14A1-061") {
    return {
      explanation: `A MODIS active-fire product catalog record. The provider product reports satellite-derived thermal-anomaly information; Third Eye has not independently confirmed a fire.${platformName}`,
      applications: ["Reviewing source-reported active-fire products", "Fire-monitoring research"],
    };
  }
  if (collectionId === "modis-13Q1-061") {
    return {
      explanation: `A MODIS vegetation-index product catalog record. It identifies where a vegetation observation is available; no crop or vegetation condition is inferred here.${platformName}`,
      applications: ["Vegetation-season and crop-monitoring research", "Comparing vegetation-index observations"],
    };
  }
  return {
    explanation: `A ${platform ?? "satellite"} catalog observation from ${collectionId}. The provider record identifies the available observation and footprint; its pixels have not been analyzed here.`,
    applications: [],
  };
}

function analysisTarget(
  nisar: NISARGranule | undefined,
  observation: PlanetaryObservation | undefined,
  live: LiveEarthEvent | undefined,
): ObservationExplanationTarget | null {
  if (nisar) {
    const footprint = nisar.footprint ?? [];
    const longs = footprint.map(([lng]) => lng).filter(Number.isFinite);
    const lats = footprint.map(([, lat]) => lat).filter(Number.isFinite);
    const bounds: GeographicBounds | null = nisar.bounds
      ? [nisar.bounds.west, nisar.bounds.south, nisar.bounds.east, nisar.bounds.north]
      : longs.length && lats.length
        ? [Math.min(...longs), Math.min(...lats), Math.max(...longs), Math.max(...lats)]
        : null;
    const coordinates = bounds
      ? { lat: (bounds[1] + bounds[3]) / 2, lng: (bounds[0] + bounds[2]) / 2 }
      : null;
    const { sourceMetadata, ...normalizedFields } = nisar;
    const productDefinition = NISAR_PRODUCTS.find(product => product.code === nisar.productCode);
    return {
      id: nisar.id,
      kind: "nisar",
      source: `NASA CMR / ${nisar.producer || "NISAR"}`,
      title: nisar.title,
      product: nisar.productCode,
      date: nisar.startDate,
      coordinates,
      bounds,
      metadata: {
        normalizedFields,
        sourceLocation: namedLocation(sourceMetadata ?? undefined),
        productDefinition: productDefinition
          ? { level: productDefinition.level, name: productDefinition.name, description: productDefinition.description }
          : null,
        providerRecord: sourceMetadata ?? {},
      },
    };
  }
  if (observation) {
    const geometryBoundsValue = observation.bbox ?? geometryBounds(observation.geometry ?? null);
    const coordinates = observation.geometry?.type === "Point"
      ? { lat: observation.geometry.coordinates[1]!, lng: observation.geometry.coordinates[0]! }
      : geometryBoundsValue
        ? { lat: (geometryBoundsValue[1] + geometryBoundsValue[3]) / 2, lng: (geometryBoundsValue[0] + geometryBoundsValue[2]) / 2 }
        : null;
    const { sourceMetadata, ...normalizedFields } = observation;
    return {
      id: observation.id,
      kind: "satellite-observation",
      source: `Microsoft Planetary Computer / ${observation.collectionLabel}`,
      title: observation.title,
      product: observation.collectionId,
      date: observation.datetime,
      coordinates,
      bounds: geometryBoundsValue,
      metadata: {
        normalizedFields,
        sourceLocation: namedLocation(sourceMetadata ?? undefined),
        providerRecord: sourceMetadata ?? {},
      },
    };
  }
  if (live) {
    const { sourceMetadata, ...normalizedFields } = live;
    return {
      id: live.id,
      kind: "public-event",
      source: live.source,
      title: live.title,
      product: live.type,
      date: live.date,
      coordinates: { lat: live.lat, lng: live.lng },
      bounds: geometryBounds(live.geometry ?? null),
      metadata: { normalizedFields, providerRecord: sourceMetadata ?? {} },
    };
  }
  return null;
}

export function ContextPanel() {
  const selectedId = useApp((s) => s.selectedId);
  const select = useApp((s) => s.select);
  const agentFinding = useApp((s) => selectedId ? s.agentFindings.find((item) => item.id === selectedId) : undefined);
  const live = useApp((s) => selectedId ? s.liveEvents.find((item) => item.id === selectedId) : undefined);
  const observation = useApp((s) => selectedId
    ? s.planetaryComputerResult?.items.find((item) => item.id === selectedId)
    : undefined);
  const nisar = useApp((s) => selectedId ? s.nisarGranules.find((item) => item.id === selectedId) : undefined);
  const location = useApp((s) => s.locationResult);
  const locationStatus = useApp((s) => s.locationStatus);
  const locationError = useApp((s) => s.locationError);
  const visualization = useApp((s) => s.planetaryVisualization);
  const visualizationStatus = useApp((s) => s.planetaryVisualizationStatus);
  const visualizationError = useApp((s) => s.planetaryVisualizationError);
  const visualizationEnabled = useApp((s) => s.layers.has("selected-imagery"));
  const visualizationOpacity = useApp((s) => s.opacity["selected-imagery"] ?? 75);
  const requestVisualization = useApp((s) => s.requestPlanetaryVisualization);
  const scientificJob = useApp((s) => s.scientificJob);
  const scientificJobSubmitting = useApp((s) => s.scientificJobSubmitting);
  const scientificJobPreviewUrl = useApp((s) => s.scientificJobPreviewUrl);
  const scientificJobRasterUrl = useApp((s) => s.scientificJobRasterUrl);
  const scientificJobError = useApp((s) => s.scientificJobError);
  const restoreScientificJob = useApp((s) => s.restoreScientificJob);
  const startSentinel2NDVI = useApp((s) => s.startSentinel2NDVI);
  const cancelScientificJob = useApp((s) => s.cancelScientificJob);
  const aoi = useApp((s) => s.aoi);
  const toggleLayer = useApp((s) => s.toggleLayer);
  const setOpacity = useApp((s) => s.setOpacity);
  const [jobActionError, setJobActionError] = useState<string | null>(null);
  const explanationTarget = useMemo(
    () => analysisTarget(nisar, observation, live),
    [live, nisar, observation],
  );
  const aiExplanation = useObservationExplanation(explanationTarget);

  useEffect(() => {
    let active = true;
    void restoreScientificJob().catch(error => {
      if (active) {
        useApp.setState({
          scientificJobError: error instanceof Error ? error.message : "The saved scientific job could not be restored.",
        });
      }
    });
    return () => { active = false; };
  }, [restoreScientificJob]);

  if (agentFinding) {
    return (
      <div className="glass scroll-thin w-[320px] animate-fade-up overflow-y-auto">
        <div className="flex items-start justify-between border-b border-border p-4">
          <div className="min-w-0">
            <div className="font-mono text-[10px] tracking-[0.16em] text-primary">THIRD EYE · SCREENING FINDING</div>
            <h2 className="mt-2 break-words text-[16px] font-medium leading-snug">
              <span className="mr-2 font-mono text-primary">#{agentFinding.rank}</span>{agentFinding.name}
            </h2>
            <p className="mt-1 text-[10px] text-muted-foreground">Location resolved from {agentFinding.locationSource}</p>
          </div>
          <Button variant="ghost" onClick={() => select(null)} aria-label="Dismiss finding" className="shrink-0 text-subtle hover:text-foreground"><X className="size-4" /></Button>
        </div>
        <div className="space-y-3 p-4">
          <p className="text-[12px] leading-relaxed">{agentFinding.rationale}</p>
          {agentFinding.evidence.length > 0 && (
            <section className="rounded-md border border-border bg-background/40 p-3">
              <h3 className="label-xs mb-2">FACTORS CONSIDERED</h3>
              <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-muted-foreground">
                {agentFinding.evidence.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
              </ul>
            </section>
          )}
          <div className="rounded-md border border-amber/25 bg-amber/5 p-3">
            <div className="label-xs text-amber">CONFIDENCE · SCREENING ONLY</div>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              This is a comparative AI screening, not a validated suitability model or a parcel-level recommendation. Verify local soil, water, cultivar, and seasonal conditions before acting.
            </p>
          </div>
          <p className="font-mono text-[9px] leading-relaxed tracking-wider text-subtle">
            THE MARKER IS A GEOCODED PLACE REFERENCE, NOT A MEASURED SUITABILITY AREA.
          </p>
        </div>
      </div>
    );
  }

  if (observation) {
    const raw = observation.sourceMetadata;
    const properties = isRecord(raw?.properties) ? raw.properties : undefined;
    const geometryBoundsValue = observation.bbox ?? geometryBounds(observation.geometry);
    const coordinates = observation.geometry?.type === "Point"
      ? { lat: observation.geometry.coordinates[1]!, lng: observation.geometry.coordinates[0]!, approximate: false }
      : geometryBoundsValue
        ? {
            lat: (geometryBoundsValue[1] + geometryBoundsValue[3]) / 2,
            lng: (geometryBoundsValue[0] + geometryBoundsValue[2]) / 2,
            approximate: true,
          }
        : null;
    const insight = planetaryExplanation(observation.collectionId, observation.platform);
    const { sourceMetadata: _sourceMetadata, ...normalizedFields } = observation;
    const technicalMetadata = {
      "Normalized catalog fields": normalizedFields,
      "Original STAC item": raw ?? {},
    };
    const availability = properties
      ? firstDate(properties, ["created", "updated"])
      : null;
    const locationName = namedLocation(raw ?? undefined);
    const sourceItemId = observation.id.startsWith("pc:sentinel-2-l2a:")
      ? observation.id.slice("pc:sentinel-2-l2a:".length)
      : null;
    const matchingJob = sourceItemId && scientificJob?.itemId === sourceItemId ? scientificJob : null;
    const canProcessNDVI = observation.collectionId === "sentinel-2-l2a" && Boolean(sourceItemId);
    const hasPolygonAOI = aoi?.feature.geometry.type === "Polygon" || aoi?.feature.geometry.type === "MultiPolygon";
    return (
      <ObservationDetails
        key={observation.id}
        title={coordinates
          ? `Satellite observation over ${formatCoord(coordinates.lat, coordinates.lng)}`
          : `Satellite observation · ${observation.collectionLabel}`}
        subtitle={observation.title}
        kindLabel="SATELLITE OBSERVATION · CATALOG RECORD"
        dataClass="Processed satellite product · catalog metadata"
        source={`Microsoft Planetary Computer · ${observation.collectionLabel}`}
        sourceUrl={observation.itemUrl}
        sourceLinks={observation.previewUrl ? [{ label: "Open interactive preview", url: observation.previewUrl }] : []}
        countryRegion={locationName}
        coordinates={coordinates}
        timeline={[
          { label: "Acquisition time", value: observation.datetime ? formatDate(observation.datetime) : null },
          { label: "Availability / publication", value: availability },
        ]}
        aiExplanation={aiExplanation}
        explanation={insight.explanation}
        applications={insight.applications}
        technicalMetadata={technicalMetadata}
        integrityNote="CATALOG RECORD ONLY · THE SATELLITE PIXELS WERE NOT LOADED OR ANALYZED."
        close={() => select(null)}
        extraContent={
          <div className="space-y-2">
            {canProcessNDVI && (
              <section className="space-y-2 rounded-md border border-primary/25 bg-primary/5 p-2.5" aria-label="Sentinel-2 NDVI processing">
                <div>
                  <p className="text-[10px] font-medium text-foreground">Process this Sentinel-2 scene</p>
                  <p className="text-[9px] leading-relaxed text-muted-foreground">
                    Calculate a single-date NDVI raster from the actual B04/B08 data and selected polygon area. This is a measurement, not a crop-health diagnosis.
                  </p>
                </div>
                {!hasPolygonAOI && (
                  <p className="text-[9px] text-amber">Draw a polygon area of interest before processing.</p>
                )}
                {matchingJob && (matchingJob.status === "queued" || matchingJob.status === "processing") ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[9px] text-muted-foreground">
                      <span>{matchingJob.status === "queued" ? "Queued · waiting for worker" : matchingJob.stage}</span>
                      <span className="font-mono tabular-nums">{matchingJob.progress}%</span>
                    </div>
                    <progress className="h-1 w-full accent-primary" value={matchingJob.progress} max={100} aria-label={`Processing progress ${matchingJob.progress}%`} />
                    <p className="text-[8px] leading-relaxed text-muted-foreground">A separately deployed Python worker is required to process queued jobs.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-[9px]"
                      onClick={() => void cancelScientificJob(matchingJob.id).catch(error => setJobActionError(error instanceof Error ? error.message : "The job could not be cancelled."))}
                    >
                      Cancel processing
                    </Button>
                  </div>
                ) : matchingJob?.status === "completed" && matchingJob.result ? (
                  <div className="space-y-2">
                    <dl className="grid grid-cols-2 gap-1 text-[9px]">
                      <div><dt className="text-muted-foreground">Mean NDVI</dt><dd className="font-mono">{matchingJob.result.summary.mean.toFixed(3)}</dd></div>
                      <div><dt className="text-muted-foreground">Valid pixels</dt><dd className="font-mono">{matchingJob.result.summary.valid_pixels.toLocaleString()}</dd></div>
                      <div><dt className="text-muted-foreground">Resolution</dt><dd className="font-mono">{matchingJob.result.summary.spatial_resolution_m} m</dd></div>
                      <div><dt className="text-muted-foreground">Masked AOI</dt><dd className="font-mono">{matchingJob.result.summary.masked_area_percent}%</dd></div>
                    </dl>
                    <p className="text-[9px] leading-relaxed text-muted-foreground">{matchingJob.result.interpretation}</p>
                    {scientificJobRasterUrl && (
                      <a href={scientificJobRasterUrl} target="_blank" rel="noopener noreferrer" className="block text-[9px] text-primary hover:underline">
                        Download processed GeoTIFF
                      </a>
                    )}
                    <div className="flex items-center gap-1.5 text-[8px] text-muted-foreground">
                      <span className="size-2 rounded-sm bg-[#643691]" /> Low
                      <span className="size-2 rounded-sm bg-[#55aa49]" /> Moderate
                      <span className="size-2 rounded-sm bg-[#0d4f2d]" /> High NDVI
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    className="w-full text-[10px]"
                    disabled={!hasPolygonAOI || scientificJobSubmitting}
                    onClick={() => {
                      setJobActionError(null);
                      void startSentinel2NDVI().catch(error => setJobActionError(error instanceof Error ? error.message : "The scientific job could not be submitted."));
                    }}
                  >
                    {scientificJobSubmitting ? "Submitting job…" : matchingJob?.status === "failed" ? "Retry NDVI processing" : "Calculate NDVI"}
                  </Button>
                )}
                {(jobActionError || (matchingJob?.status === "failed" ? matchingJob.errorMessage : null) || (matchingJob ? scientificJobError : null)) && (
                  <p role="status" className="text-[9px] leading-relaxed text-destructive">
                    {jobActionError ?? (matchingJob?.status === "failed" ? matchingJob.errorMessage : scientificJobError)}
                  </p>
                )}
                {matchingJob?.status === "cancelled" && <p className="text-[9px] text-muted-foreground">Processing was cancelled.</p>}
              </section>
            )}
            {visualization?.itemId === observation.id ? (
              <section className="space-y-2 rounded-md border border-border bg-background/30 p-2.5" aria-label="Verified observation imagery">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-medium text-foreground">Verified imagery</p>
                    <p className="text-[9px] text-muted-foreground">{visualization.source} · {visualization.datetime ? formatDate(visualization.datetime) : "Date not reported"}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => toggleLayer("selected-imagery")} aria-pressed={visualizationEnabled}>
                    {visualizationEnabled ? "Hide" : "Show"}
                  </Button>
                </div>
                {visualizationEnabled && (
                  <label className="flex items-center gap-2 text-[9px] text-muted-foreground">
                    Opacity
                    <input
                      aria-label="Satellite imagery opacity"
                      type="range"
                      min="0"
                      max="100"
                      value={visualizationOpacity}
                      onChange={event => setOpacity("selected-imagery", Number(event.target.value))}
                      className="min-w-0 flex-1 accent-primary"
                    />
                    <span className="w-8 text-right tabular-nums">{visualizationOpacity}%</span>
                  </label>
                )}
                <p className="text-[8px] text-muted-foreground">{visualization.attribution}</p>
              </section>
            ) : (
              <section className="space-y-1.5 rounded-md border border-border bg-background/30 p-2.5">
                <Button
                  variant="outline"
                  className="w-full text-[10px]"
                  disabled={visualizationStatus === "loading"}
                  onClick={() => void requestVisualization(observation.id)}
                >
                  {visualizationStatus === "loading" ? "VERIFYING IMAGERY…" : "CHECK FOR VIEWABLE IMAGERY"}
                </Button>
                {visualizationError && (
                  <p className="text-[9px] text-muted-foreground">
                    No verified imagery path is available for this item. {visualizationError}
                  </p>
                )}
              </section>
            )}
          </div>
        }
      />
    );
  }

  if (nisar) {
    const raw = nisar.sourceMetadata;
    const umm = isRecord(raw?.umm) ? raw.umm : undefined;
    const meta = isRecord(raw?.meta) ? raw.meta : undefined;
    const coordinates = nisar.bounds
      ? {
          lat: (nisar.bounds.south + nisar.bounds.north) / 2,
          lng: (nisar.bounds.west + nisar.bounds.east) / 2,
          approximate: true,
        }
      : nisar.footprint?.length
        ? {
            lat: nisar.footprint.reduce((sum, point) => sum + point[1], 0) / nisar.footprint.length,
            lng: nisar.footprint.reduce((sum, point) => sum + point[0], 0) / nisar.footprint.length,
            approximate: true,
          }
        : null;
    const insight = getNISARObservationExplanation(nisar.productCode, nisar.maturity);
    const { sourceMetadata: _sourceMetadata, ...normalizedFields } = nisar;
    const technicalMetadata = {
      "Normalized catalog fields": normalizedFields,
      "NASA CMR source record": raw ?? {},
    };
    return (
      <ObservationDetails
        key={nisar.id}
        title={coordinates
          ? `Satellite observation over ${formatCoord(coordinates.lat, coordinates.lng)}`
          : `NISAR ${nisar.productCode} satellite observation`}
        subtitle={`${insight.label} · NISAR`}
        kindLabel="SATELLITE OBSERVATION · NISAR"
        dataClass="NISAR radar dataset · catalog record"
        source={`NASA CMR / ${nisar.producer || "ASF DAAC"}`}
        sourceUrl={nisar.metadataUrl}
        sourceLinks={[
          { label: "Open NASA Earthdata granule", url: nisar.earthdataSearchUrl },
          ...(nisar.dataUrl ? [{ label: "Open source data file", url: nisar.dataUrl }] : []),
        ]}
        countryRegion={namedLocation(umm ?? raw)}
        coordinates={coordinates}
        timeline={[
          { label: "Acquisition start", value: nisar.startDate ? formatDate(nisar.startDate) : null },
          { label: "Acquisition end", value: nisar.endDate ? formatDate(nisar.endDate) : null },
          { label: "Product created", value: nisar.productionTime ? formatDate(nisar.productionTime) : null },
          { label: "Catalog record revised", value: firstDate(meta, ["revision-date", "revision_date"]) },
        ]}
        aiExplanation={aiExplanation}
        explanation={insight.explanation}
        applications={insight.applications}
        technicalMetadata={technicalMetadata}
        integrityNote="REAL NASA CMR CATALOG RECORD · A BROWSE IMAGE IS A QUICKLOOK, NOT THE FULL SCIENCE RASTER."
        close={() => select(null)}
        extraContent={nisar.browseUrl ? (
          <details className="rounded-md border border-border bg-background/30 p-2.5">
            <summary className="cursor-pointer text-[10px] text-primary">View NASA browse quicklook</summary>
            <a href={nisar.browseUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block">
              <img src={nisar.browseUrl} alt={`NASA browse quicklook for ${nisar.granuleId}`} loading="lazy" className="max-h-44 w-full rounded border border-border object-contain" />
            </a>
          </details>
        ) : null}
      />
    );
  }

  if (live) {
    const raw = live.sourceMetadata;
    const rawProperties = isRecord(raw?.properties) ? raw.properties : undefined;
    const { sourceMetadata: _sourceMetadata, ...normalizedFields } = live;
    const sourceLabel = live.source === "USGS" ? "USGS Earthquake Catalog" : "NASA EONET";
    return (
      <ObservationDetails
        key={live.id}
        title={live.source === "USGS"
          ? `Earthquake reported near ${live.region || formatCoord(live.lat, live.lng)}`
          : live.title}
        subtitle={`${live.metric} · ${live.metricLabel} · ${live.summary}`}
        kindLabel="SOURCE-REPORTED PUBLIC EVENT"
        dataClass="Public event context · not satellite imagery"
        source={sourceLabel}
        sourceUrl={live.sourceUrl}
        countryRegion={live.source === "USGS" ? live.region : live.country || null}
        coordinates={{ lat: live.lat, lng: live.lng, approximate: false }}
        timeline={[
          { label: "Reported time", value: formatDate(live.date) },
          { label: "Provider update", value: rawProperties ? firstDate(rawProperties, ["updated", "updatedAt", "updated_at"]) : null },
        ]}
        aiExplanation={aiExplanation}
        explanation={live.source === "USGS"
          ? `The USGS catalog reports an earthquake at this location. ${live.summary} This is an agency report, not a NISAR observation or a Third Eye hazard assessment.`
          : `${live.summary} NASA EONET is reporting an environmental event; this record is contextual information, not a satellite measurement or confirmation by Third Eye.`}
        applications={[
          "Providing source-attributed context alongside satellite observations",
          "Reviewing the event report at its original provider",
        ]}
        technicalMetadata={{
          "Normalized event fields": normalizedFields,
          "Original provider record": raw ?? {},
        }}
        integrityNote="SOURCE-REPORTED PUBLIC EVENT CONTEXT · NOT A NISAR MEASUREMENT OR A THIRD EYE HAZARD PREDICTION."
        close={() => select(null)}
        extraContent={live.source === "USGS" && live.pagerAlert ? (
          <section className="rounded-md border border-amber/30 bg-amber/5 p-2.5">
            <div className="label-xs text-amber">USGS PAGER ALERT · {live.pagerAlert.toUpperCase()}</div>
            <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">
              {live.nisarURCandidate
                ? "This reported Orange/Red alert is a NISAR Urgent Response review candidate only; it does not confirm tasking or an acquisition."
                : "This alert is public event context and does not indicate NISAR Urgent Response tasking."}
            </p>
          </section>
        ) : null}
      />
    );
  }

  if (location || locationStatus === "loading" || locationStatus === "error") {
    return (
      <div className="glass w-[320px] animate-fade-up">
        <div className="flex items-start justify-between border-b border-border p-4">
          <div className="min-w-0">
            <div className="font-mono text-[10px] tracking-[0.16em] text-primary">MAP LOCATION · PUBLIC PLACE CONTEXT</div>
            <h2 className="mt-2 text-[16px] font-medium leading-snug">{location?.displayName ?? (locationStatus === "loading" ? "Looking up this location…" : "Place name unavailable")}</h2>
            {location && <div className="mt-2 font-mono text-[11px] text-muted-foreground">{formatCoord(location.latitude, location.longitude)}</div>}
          </div>
          <Button variant="ghost" onClick={() => select(null)} aria-label="Dismiss location" className="shrink-0 text-subtle hover:text-foreground"><X className="size-4" /></Button>
        </div>
        <div className="space-y-3 p-4">
          {locationStatus === "loading" && <p className="text-xs text-muted-foreground">Requesting a place name for the clicked coordinates.</p>}
          {locationError && <p role="status" className="text-xs text-destructive">{locationError}</p>}
          {location && (
            <dl className="metadata-grid">
              <div><dt>Place type</dt><dd>{location.type}</dd></div>
              <div><dt>Lookup source</dt><dd>{location.attribution}</dd></div>
              <div><dt>Location confidence</dt><dd>{location.confidence === null ? "Not reported by provider" : `${Math.round(location.confidence * 100)}% · provider estimate`}</dd></div>
              {location.providerRelevance !== null && <div><dt>Provider relevance</dt><dd>{location.providerRelevance.toFixed(2)} · Photon ranking</dd></div>}
            </dl>
          )}
          <p className="font-mono text-[9px] leading-relaxed tracking-wider text-subtle">GEOCODED PUBLIC CONTEXT ONLY · NOT A NISAR OBSERVATION, SCIENTIFIC MEASUREMENT, OR HAZARD ASSESSMENT</p>
        </div>
      </div>
    );
  }

  return (
    <div className="glass w-[300px] p-5">
      <div className="mb-3 flex items-center gap-2"><LogoMark size={16} /><span className="font-mono text-[11px] tracking-[0.25em]">THIRD EYE</span></div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">Select a real NASA CMR acquisition or source-reported public event to inspect.</p>
    </div>
  );
}
