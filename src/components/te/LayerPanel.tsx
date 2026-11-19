import { useEffect, useState } from "react";
import {
  Activity,
  ChevronDown,
  CloudSun,
  Droplets,
  Eye,
  EyeOff,
  Flame,
  LoaderCircle,
  Mountain,
  PanelLeftClose,
  Search,
  SlidersHorizontal,
  Sprout,
  Trees,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import { NISAR_COVERAGE_PRODUCT_CODES, nisarProductColor } from "@/lib/sar-registry";
import {
  getIntelligenceWorkflow,
  INTELLIGENCE_WORKFLOWS,
  type IntelligenceWorkflowId,
} from "@/lib/intelligence-workflows";
import { buildGeographicResults } from "@/lib/geographic-results";

function Row({
  id,
  label,
  swatch,
  tag,
  disabled = false,
  onToggle,
}: {
  id: string;
  label: string;
  swatch?: string;
  tag?: "LIVE" | "CATALOG";
  disabled?: boolean;
  onToggle?: (enabled: boolean) => void;
}) {
  const on = useApp((s) => s.layers.has(id));
  const toggle = useApp((s) => s.toggleLayer);
  const opacity = useApp((s) => s.opacity[id] ?? 100);
  const setOpacity = useApp((s) => s.setOpacity);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div
        className={cn(
          "group flex h-8 items-center gap-2 rounded-md px-2 text-[13px] transition-colors hover:bg-elevated",
          on ? "text-foreground" : "text-subtle",
        )}
      >
        <button
          onClick={() => (onToggle ? onToggle(!on) : toggle(id))}
          disabled={disabled}
          title={disabled ? "NISAR catalog is currently loading." : undefined}
          className="flex flex-1 items-center gap-2.5 text-left disabled:cursor-not-allowed"
          aria-pressed={on}
          aria-disabled={disabled || undefined}
        >
          <span
            className="size-2 rounded-sm"
            style={{
              background: swatch ?? "var(--primary)",
              opacity: on ? 1 : 0.3,
            }}
          />
          <span className="flex-1">{label}</span>
          {tag && (
            <span
              className={cn(
                "font-mono text-[9px] tracking-wider",
                tag === "LIVE"
                  ? "text-ok"
                  : tag === "CATALOG"
                    ? "text-primary"
                    : "text-subtle",
              )}
            >
              {tag}
            </span>
          )}
        </button>
        <button
          onClick={() => setOpen(!open)}
          disabled={disabled}
          className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed"
          aria-label="Layer settings"
          aria-disabled={disabled || undefined}
        >
          <SlidersHorizontal className="size-3.5 text-subtle" />
        </button>
        <button
          onClick={() => (onToggle ? onToggle(!on) : toggle(id))}
          disabled={disabled}
          aria-label="Toggle visibility"
          aria-disabled={disabled || undefined}
        >
          {on ? (
            <Eye className="size-3.5 text-muted-foreground" />
          ) : (
            <EyeOff className="size-3.5 text-subtle" />
          )}
        </button>
      </div>
      {open && (
        <div className="flex items-center gap-2 px-2 pb-2 pl-6">
          <span className="label-xs">Opacity</span>
          <input
            type="range"
            min={0}
            max={100}
            value={opacity}
            onChange={(e) => setOpacity(id, +e.target.value)}
            className="h-1 flex-1 accent-[var(--primary)]"
          />
          <span className="w-8 text-right font-mono text-[10px] text-muted-foreground">
            {opacity}%
          </span>
        </div>
      )}
    </div>
  );
}

const WORKFLOW_ICONS = {
  "wildfire-monitoring": Flame,
  "flood-water": Droplets,
  "land-forest-change": Trees,
  "ice-glacier-observation": Mountain,
  "soil-agriculture": Sprout,
} as const;

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-border pt-2 first:border-0 first:pt-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-2 py-1.5"
      >
        <span className="label-xs">{title}</span>
        <ChevronDown
          className={cn(
            "size-3 text-subtle transition-transform",
            !open && "-rotate-90",
          )}
        />
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}

function SourceHealth({
  name,
  status,
  detail,
}: {
  name: string;
  status: string;
  detail?: string | null;
}) {
  const tone = status === "ready" || status === "configured"
    ? "bg-ok"
    : status === "loading"
      ? "animate-pulse bg-primary"
      : status === "partial" || status === "not-configured"
        ? "bg-amber"
        : status === "error"
          ? "bg-destructive"
          : "bg-subtle";
  const spokenStatus = status === "idle" ? "not checked"
    : status === "not-configured" ? "configuration required"
      : status;
  return (
    <span
      title={`${name}: ${spokenStatus}${detail ? ` · ${detail}` : ""}`}
      aria-label={`${name}: ${spokenStatus}${detail ? ` · ${detail}` : ""}`}
      className="inline-flex min-w-0 items-center gap-1.5 rounded border border-border/70 bg-background/35 px-1.5 py-1 font-mono text-[8px] text-muted-foreground"
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", tone)} aria-hidden="true" />
      <span className="truncate">{name}</span>
    </span>
  );
}

function ScientificResultLayer() {
  const job = useApp(state => state.scientificJob);
  const rasterUrl = useApp(state => state.scientificJobRasterUrl);
  const error = useApp(state => state.scientificJobError);
  if (!job) {
    return error ? <p role="status" className="mx-2 mt-2 text-[9px] leading-relaxed text-amber">{error}</p> : null;
  }
  if (job.status === "queued" || job.status === "processing") {
    return (
      <div className="mx-2 mt-2 rounded border border-border/70 bg-background/30 px-2 py-1.5 text-[10px] text-muted-foreground" role="status">
        {job.status === "queued" ? "NDVI job queued; a separate Python worker must be running to process it." : `NDVI processing · ${job.stage} · ${job.progress}%`}
      </div>
    );
  }
  if (job.status !== "completed" || !job.result) {
    return job.status === "failed"
      ? <p role="status" className="mx-2 mt-2 text-[9px] leading-relaxed text-amber">{job.errorMessage ?? "Scientific processing failed."}</p>
      : null;
  }

  const acquisitionTime = job.provenance?.acquisition_time;
  const source = job.provenance?.source;
  return (
    <div className="mt-2">
      <Row id="scientific-result" label="Sentinel-2 NDVI result" swatch="#55AA49" />
      <div className="mx-2 rounded border border-border/70 bg-background/30 px-2 py-1.5">
        <p className="text-[9px] leading-relaxed text-muted-foreground">
          Derived single-date vegetation-index raster · {typeof source === "string" ? source : "source not reported"}
          {typeof acquisitionTime === "string" ? ` · ${acquisitionTime.slice(0, 10)}` : ""}
        </p>
        <div className="mt-1.5 h-2 rounded-sm" aria-label="NDVI color scale from low to high" style={{ background: "linear-gradient(90deg, #643691, #DC3939, #F0A245, #F1DC51, #55AA49, #0D4F2D)" }} />
        <div className="mt-1 flex justify-between font-mono text-[8px] text-muted-foreground"><span>−1</span><span>0</span><span>+1</span></div>
        <p className="mt-1 text-[9px] text-muted-foreground">Mean NDVI {job.result.summary.mean.toFixed(3)} · {job.result.summary.spatial_resolution_m} m · {job.result.summary.valid_pixels.toLocaleString()} valid pixels</p>
        {rasterUrl && <a href={rasterUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block text-[9px] text-primary hover:underline">Download processed GeoTIFF ↗</a>}
      </div>
    </div>
  );
}


function GuestNISARResultLayer() {
  const result = useApp(state => state.guestNISARMapResult);
  if (!result) return null;
  return (
    <div className="mt-2">
      <Row id="nisar-guest-result" label="NISAR GCOV change overlay" swatch="#DC433D" />
      <p className="mx-2 text-[9px] leading-relaxed text-muted-foreground">
        Quicklook registered to the raster bounds on the globe/map. Use the GeoTIFF for precise GIS analysis; the PNG is a display-only preview.
      </p>
    </div>
  );
}

function IntelligenceWorkspace() {
  const appState = useApp((state) => state);
  const geographicResults = buildGeographicResults(appState);
  const workflowId = useApp((s) => s.activeIntelligenceWorkflowId);
  const setWorkflowId = useApp((s) => s.setActiveIntelligenceWorkflow);
  const setMode = useApp((s) => s.setMode);
  const workflow = getIntelligenceWorkflow(workflowId);
  const aoi = useApp((s) => s.aoi);
  const time = useApp((s) => s.time);
  const liveEvents = useApp((s) => s.liveEvents);
  const liveProviderStatus = useApp((s) => s.liveProviderStatus);
  const liveDataStatus = useApp((s) => s.liveDataStatus);
  const refreshLiveData = useApp((s) => s.refreshLiveData);
  const nisarStatus = useApp((s) => s.nisarStatus);
  const nisarError = useApp((s) => s.nisarError);
  const nisarGranules = useApp((s) => s.nisarGranules);
  const nisarGranuleHits = useApp((s) => s.nisarGranuleHits);
  const nisarPage = useApp((s) => s.nisarPage);
  const nisarHasMore = useApp((s) => s.nisarHasMore);
  const nisarSelectedProductCodes = useApp((s) => s.nisarSelectedProductCodes);
  const refreshNISARData = useApp((s) => s.refreshNISARData);
  const planetaryComputerStatus = useApp((s) => s.planetaryComputerStatus);
  const planetaryComputerWorkflowId = useApp((s) => s.planetaryComputerWorkflowId);
  const planetaryComputerError = useApp((s) => s.planetaryComputerError);
  const planetaryComputerResult = useApp((s) => s.planetaryComputerResult);
  const refreshPlanetaryComputer = useApp((s) => s.refreshPlanetaryComputer);
  const meteomaticsStatus = useApp((s) => s.meteomaticsStatus);
  const meteomaticsError = useApp((s) => s.meteomaticsError);
  const meteomaticsContext = useApp((s) => s.meteomaticsContext);
  const refreshMeteomatics = useApp((s) => s.refreshMeteomatics);
  const select = useApp((s) => s.select);

  const currentEnd = time.current < time.end ? time.current : time.end;
  const activeResult = planetaryComputerResult?.workflowId === workflowId ? planetaryComputerResult : null;
  const workflowProductCodes = new Set<string>(workflow.nisarProductCodes);
  const activePCStatus = planetaryComputerWorkflowId === workflowId ? planetaryComputerStatus : activeResult ? "ready" : "idle";
  const activePCError = planetaryComputerWorkflowId === workflowId ? planetaryComputerError : null;
  const nisarScopeMatches = nisarSelectedProductCodes.length === workflow.nisarProductCodes.length &&
    workflow.nisarProductCodes.every((code) => nisarSelectedProductCodes.includes(code));
  const workflowGranules = nisarScopeMatches
    ? nisarGranules.filter(granule => workflowProductCodes.has(granule.productCode))
    : [];
  const sortedGranules = [...workflowGranules].sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));
  const mappedNisarIds = new Set(geographicResults
    .filter(result => result.kind === "nisar-acquisition")
    .map(result => result.id));
  const mappedNisarCount = workflowGranules.filter(granule => mappedNisarIds.has(granule.id)).length;
  const contextEvents = geographicResults.flatMap(result =>
    result.kind === "public-event" && result.sourceRecord && "sourceLabel" in result.sourceRecord
      ? [result.sourceRecord]
      : [],
  ).filter(event => workflow.eventTypes.includes(event.type))
    .sort((a, b) => b.date.localeCompare(a.date));
  const visibleObservations = activeResult?.items ?? [];
  const mappedObservationIds = new Set(geographicResults
    .filter(result => result.kind === "satellite-observation")
    .map(result => result.id));
  const searchDisabled = nisarStatus === "loading" || planetaryComputerStatus === "loading";

  useEffect(() => {
    if (meteomaticsStatus === "idle") void refreshMeteomatics();
  }, [meteomaticsStatus, refreshMeteomatics]);

  const discover = () => {
    const app = useApp.getState();
    for (const productCode of workflow.nisarProductCodes) {
      app.toggleLayer(`prod-${productCode}`, true);
    }
    void refreshNISARData([...workflow.nisarProductCodes]);
    void refreshPlanetaryComputer(workflowId);
    void refreshMeteomatics(aoi?.center);
  };

  return (
    <div className="space-y-3">
      <section className="rounded-md border border-primary/25 bg-primary/[0.045] p-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="font-mono text-[9px] tracking-[0.16em] text-primary">OBSERVATION WORKSPACE</div>
          <span className="font-mono text-[8px] text-subtle">{aoi ? "AREA SELECTED" : "GLOBAL SEARCH"}</span>
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          {aoi ? aoi.name : "Search globally, or draw an area of interest to narrow results."}
        </p>
        <div className="mt-1 font-mono text-[8px] text-subtle">{time.start} — {currentEnd}</div>
        <div className="mt-2 grid grid-cols-2 gap-1">
          {INTELLIGENCE_WORKFLOWS.map((item) => {
            const Icon = WORKFLOW_ICONS[item.id];
            const active = workflowId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setWorkflowId(item.id)}
                aria-pressed={active}
                className={cn(
                  "flex min-h-9 items-center gap-1.5 rounded border px-1.5 py-1 text-left text-[9px] leading-tight transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary",
                  active
                    ? "border-primary/45 bg-primary/10 text-foreground"
                    : "border-border/80 bg-background/30 text-muted-foreground hover:bg-elevated hover:text-foreground",
                )}
              >
                <Icon className={cn("size-3 shrink-0", active ? "text-primary" : "text-subtle")} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[9px] leading-relaxed text-muted-foreground">{workflow.description}</p>
        <p className="mt-1 text-[8px] leading-relaxed text-subtle">
          Selecting a goal searches NASA CMR and Planetary Computer automatically. Results are source catalog records and footprints, not derived science.
        </p>
        <Button
          size="sm"
          className="mt-2 h-8 w-full gap-1.5 text-[10px]"
          disabled={searchDisabled}
          onClick={discover}
        >
          {searchDisabled ? <LoaderCircle className="size-3 animate-spin" /> : <Search className="size-3" />}
          {searchDisabled ? "SEARCHING OBSERVATION CATALOGS…" : "REFRESH OBSERVATIONS"}
        </Button>
      </section>

      <section aria-labelledby="workflow-context-title">
        <div className="mb-1.5 flex items-center justify-between px-0.5">
          <h2 id="workflow-context-title" className="font-mono text-[9px] tracking-[0.14em] text-subtle">EVENT CONTEXT</h2>
          <span className="font-mono text-[8px] text-subtle">{contextEvents.length} ON MAP</span>
        </div>
        <p className="px-2 text-[9px] leading-relaxed text-muted-foreground">
          USGS and NASA EONET reports are optional map context, not satellite detections. Turn them on in Data layers.
        </p>
        <Button size="sm" variant="outline" className="mx-2 mt-1 h-7 w-[calc(100%-1rem)] text-[9px]" onClick={() => setMode("science")}>
          MANAGE MAP LAYERS
        </Button>
        {workflow.eventTypes.length === 0 ? (
          <p className="rounded border border-border/70 bg-background/30 px-2 py-2 text-[9px] leading-relaxed text-muted-foreground">
            No public event categories are mapped to this workflow. Event records will not be inferred.
          </p>
        ) : contextEvents.length ? (
          <div className="space-y-1">
            {contextEvents.slice(0, 4).map((event) => (
              <article key={event.id} className="rounded border border-border/70 bg-background/30 px-2 py-1.5">
                <button type="button" onClick={() => select(event.id)} className="block w-full text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary">
                  <span className="block truncate text-[10px] font-medium text-foreground">{event.title}</span>
                  <span className="mt-0.5 block font-mono text-[8px] text-muted-foreground">
                    {event.source} · {event.date.slice(0, 10)} · {event.metric}
                  </span>
                </button>
                <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[8px] text-primary hover:underline">
                  Open source report ↗
                </a>
              </article>
            ))}
            {contextEvents.length > 4 && (
              <p className="px-2 text-[8px] text-subtle">
                Showing the four newest reports; the in-scope results remain available on the map.
              </p>
            )}
          </div>
        ) : (
          <p className="rounded border border-border/70 bg-background/30 px-2 py-2 text-[9px] leading-relaxed text-muted-foreground">
            {liveDataStatus === "loading"
              ? "Checking USGS and NASA EONET for source-reported events."
              : liveDataStatus === "error"
                ? "No event context loaded. Check each feed status below."
                : liveDataStatus === "partial"
                  ? "No matching event was found in the successful feed; another provider is unavailable."
                  : liveDataStatus === "idle"
                    ? "Refresh the public feeds to check for source-reported event context."
                    : "No matching source-reported events in the loaded feeds, area, and date range."}
          </p>
        )}
      </section>

      <section className="border-t border-border pt-3" aria-labelledby="workflow-observations-title">
        <div className="mb-1.5 flex items-center justify-between px-0.5">
          <h2 id="workflow-observations-title" className="font-mono text-[9px] tracking-[0.14em] text-subtle">SATELLITE OBSERVATIONS</h2>
          <span className="font-mono text-[8px] text-primary">NISAR FIRST</span>
        </div>
        <p className="px-2 py-1 text-[9px] leading-relaxed text-muted-foreground">
          Workflow results are searched by goal. Change map visibility and browse all NISAR families in Data layers.
        </p>
        {nisarSelectedProductCodes.length > 0 && (
          <div aria-label="NISAR product colors" className="flex flex-wrap gap-x-2 gap-y-1 px-2 py-1">
            {nisarSelectedProductCodes.map((code) => (
              <span key={code} className="inline-flex items-center gap-1 font-mono text-[8px] text-muted-foreground">
                <span className="size-1.5 rounded-full" style={{ backgroundColor: nisarProductColor(code) }} />
                {code}
              </span>
            ))}
          </div>
        )}
        <p className="px-2 py-1 text-[8px] leading-relaxed text-subtle">
          One page loads up to 100 recently revised records per product family. Use “Load more” to page through additional matches; a global search can contain hundreds of thousands of records. Footprints show source coverage, dots mark acquisition centers, and dashed bounds are not radar swaths.
        </p>
        {nisarScopeMatches && sortedGranules.length ? (
          <>
            <p className="px-2 py-1 font-mono text-[8px] text-muted-foreground">
              {sortedGranules.length} loaded · {mappedNisarCount} mapped · {nisarGranuleHits.toLocaleString()} CMR matches
            </p>
            <div className="scroll-thin mt-1 max-h-56 space-y-1 overflow-y-auto">
            {sortedGranules.map((granule) => (
              <button
                key={granule.id}
                type="button"
                onClick={() => select(granule.id)}
                className="block w-full rounded border border-border/70 bg-background/30 px-2 py-1.5 text-left hover:bg-elevated focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-[9px] font-medium">{granule.productCode} · {granule.platform || "NISAR"}</span>
                  <span className="shrink-0 font-mono text-[8px] text-muted-foreground">{granule.startDate?.slice(0, 10) ?? "Date not reported"}</span>
                </span>
                <span className="mt-0.5 block truncate font-mono text-[8px] text-subtle">{granule.granuleId}</span>
                {!granule.bounds && !granule.footprint && (
                  <span className="mt-0.5 block text-[8px] text-amber">Source record has no mappable extent</span>
                )}
              </button>
            ))}
            </div>
          </>
        ) : nisarScopeMatches && (nisarStatus === "ready" || nisarStatus === "partial") ? (
          <p className="px-2 py-1 text-[9px] text-muted-foreground">No loaded NISAR records match this workflow, area, and date range.</p>
        ) : nisarStatus === "error" && nisarError ? (
          <p role="status" className="px-2 py-1 text-[9px] leading-relaxed text-amber">{nisarError}</p>
        ) : (
          <p className="px-2 py-1 text-[9px] leading-relaxed text-muted-foreground">
            {nisarScopeMatches && nisarStatus === "loading" ? "Searching NASA CMR for NISAR acquisitions." : "Search to check NASA CMR coverage for this workflow."}
          </p>
        )}
        {nisarScopeMatches && nisarHasMore && (
          <Button
            variant="outline"
            size="sm"
            className="mx-2 mt-1 h-7 w-[calc(100%-1rem)] text-[9px]"
            disabled={nisarStatus === "loading"}
            onClick={() => void refreshNISARData([...workflow.nisarProductCodes], nisarPage + 1, true)}
          >
            {nisarStatus === "loading" ? "LOADING MORE NASA CMR RECORDS…" : `LOAD NEXT 100 PER PRODUCT · PAGE ${nisarPage + 1}`}
          </Button>
        )}
        {nisarScopeMatches && (
          <p className="px-2 pb-1 text-[8px] text-subtle">
            NASA CMR catalog metadata and coverage only; raster products are not processed here.
          </p>
        )}
        {nisarStatus === "partial" && nisarError && (
          <details className="mx-2 my-1 rounded border border-amber/20 bg-amber/5 px-2 py-1 text-[8px] text-amber">
            <summary className="cursor-pointer">Some NASA CMR collections were unavailable</summary>
            <p className="mt-1 leading-relaxed">{nisarError}</p>
          </details>
        )}

        <div className="mt-2 border-t border-border/70 pt-2">
          <p className="px-2 py-1 text-[9px] leading-relaxed text-muted-foreground">
            These catalog results are shown on the map only when their source is enabled in Data layers.
          </p>
          {visibleObservations.length ? (
            <div className="mt-1 space-y-1">
              <p className="px-2 text-[8px] text-subtle">
                {visibleObservations.length} catalog records · {visibleObservations.filter(item => mappedObservationIds.has(item.id)).length} mapped · {activeResult?.matched === null ? "total matches not reported" : `${activeResult?.matched.toLocaleString()} matches`} · {activeResult?.startDate} — {activeResult?.endDate}
              </p>
              <p className="px-2 text-[8px] text-subtle">
                {Object.entries(visibleObservations.reduce<Record<string, number>>((counts, item) => {
                  counts[item.collectionLabel] = (counts[item.collectionLabel] ?? 0) + 1;
                  return counts;
                }, {})).map(([label, count]) => `${label}: ${count}`).join(" · ")}
              </p>
              <div className="scroll-thin max-h-56 space-y-1 overflow-y-auto">
              {visibleObservations.map((item) => (
                <article key={item.id} className="rounded border border-border/70 bg-background/30 px-2 py-1.5">
                  <button type="button" onClick={() => select(item.id)} className="block w-full text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary">
                    <span className="block truncate text-[9px] font-medium">{item.collectionLabel}</span>
                    <span className="mt-0.5 block truncate text-[8px] text-muted-foreground">{item.platform ?? item.title}</span>
                    <span className="mt-0.5 block font-mono text-[8px] text-subtle">{item.datetime?.slice(0, 10) ?? "Date not reported"}</span>
                  </button>
                  {item.previewUrl && <a href={item.previewUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[8px] text-primary hover:underline">Open interactive preview ↗</a>}
                </article>
              ))}
              </div>
            </div>
          ) : activePCStatus === "loading" ? (
            <p className="px-2 py-1 text-[9px] text-muted-foreground">Searching real Planetary Computer STAC items…</p>
          ) : activePCStatus === "error" ? (
            <p role="status" className="px-2 py-1 text-[9px] leading-relaxed text-amber">
              {activePCError ?? "Planetary Computer search failed."} {planetaryComputerResult ? "The last successful result is retained." : ""}
            </p>
          ) : activeResult ? (
            <p className="px-2 py-1 text-[9px] leading-relaxed text-muted-foreground">
              {activeResult.matched === 0 ? "No catalog items matched this workflow, area, and date range." : "The catalog returned no displayable items for this search."}
            </p>
          ) : (
            <p className="px-2 py-1 text-[9px] text-muted-foreground">Search to discover observations complementary to NISAR.</p>
          )}
          {activeResult?.warnings.map((warning) => (
            <p key={warning} className="px-2 py-1 text-[8px] leading-relaxed text-amber">{warning}</p>
          ))}
          <p className="px-2 py-1 text-[8px] leading-relaxed text-subtle">
            Up to 100 STAC records are shown per search, balanced across collections; this bounded sample is not a complete inventory. Optical and Sentinel-1 records complement NISAR; no raster processing is claimed.
          </p>
        </div>
      </section>

      <section className="border-t border-border pt-3" aria-labelledby="weather-context-title">
        <div className="mb-1.5 flex items-center gap-1.5 px-0.5">
          <CloudSun className="size-3 text-subtle" aria-hidden="true" />
          <h2 id="weather-context-title" className="font-mono text-[9px] tracking-[0.14em] text-subtle">WEATHER CONTEXT</h2>
          <span className="ml-auto font-mono text-[8px] text-subtle">METEOMATICS</span>
        </div>
        {meteomaticsStatus === "not-configured" ? (
          <p className="rounded border border-amber/20 bg-amber/5 px-2 py-2 text-[9px] leading-relaxed text-muted-foreground">
            Not configured. Add server-only METEOMATICS_USERNAME and METEOMATICS_PASSWORD; do not use a VITE_ prefix.
          </p>
        ) : meteomaticsStatus === "error" ? (
          <p role="status" className="rounded border border-amber/20 bg-amber/5 px-2 py-2 text-[9px] leading-relaxed text-muted-foreground">
            {meteomaticsError ?? "Weather context is unavailable."}
          </p>
        ) : meteomaticsContext?.values.length ? (
          <div className="rounded border border-border/70 bg-background/30 p-2">
            <div className="grid grid-cols-3 gap-1">
              {meteomaticsContext.values.map((value) => (
                <div key={value.parameter} className="min-w-0">
                  <div className="truncate text-[8px] text-subtle">{value.label}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-foreground">{value.value} {value.unit}</div>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[8px] text-subtle">
              {meteomaticsContext.observedAt ? `Provider time ${meteomaticsContext.observedAt.replace("T", " ").slice(0, 16)} UTC` : "Provider time not reported"} · AOI-center weather context, not a SAR measurement.
            </p>
            {meteomaticsContext.warning && <p className="mt-1 text-[8px] text-amber">{meteomaticsContext.warning}</p>}
          </div>
        ) : meteomaticsStatus === "loading" ? (
          <p className="px-2 py-1 text-[9px] text-muted-foreground">Checking weather-provider configuration…</p>
        ) : meteomaticsStatus === "configured" ? (
          <p className="px-2 py-1 text-[9px] leading-relaxed text-muted-foreground">
            Configured. Select an AOI and search to request weather context at its center.
          </p>
        ) : meteomaticsStatus === "partial" ? (
          <p role="status" className="px-2 py-1 text-[9px] leading-relaxed text-amber">
            {meteomaticsError ?? "Meteomatics returned incomplete weather context."}
          </p>
        ) : (
          <p className="px-2 py-1 text-[9px] text-muted-foreground">Weather context has not been requested.</p>
        )}
      </section>

      <section className="border-t border-border pt-3">
        <div className="mb-1.5 flex items-center justify-between px-0.5">
          <h2 className="font-mono text-[9px] tracking-[0.14em] text-subtle">SOURCE HEALTH</h2>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[8px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            disabled={liveDataStatus === "loading"}
            onClick={() => void refreshLiveData()}
          >
            <Activity className="size-2.5" aria-hidden="true" /> Refresh feeds
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1">
          <SourceHealth name="NASA CMR" status={nisarStatus} detail={nisarError} />
          <SourceHealth name="Planetary Computer" status={activePCStatus} detail={planetaryComputerError} />
          <SourceHealth name="USGS" status={liveProviderStatus.usgs.status} detail={liveProviderStatus.usgs.error ?? (liveProviderStatus.usgs.cached ? "cached" : null)} />
          <SourceHealth name="NASA EONET" status={liveProviderStatus.eonet.status} detail={liveProviderStatus.eonet.error ?? (liveProviderStatus.eonet.cached ? "cached" : null)} />
          <SourceHealth name="Meteomatics" status={meteomaticsStatus} detail={meteomaticsError} />
        </div>
      </section>

      <Link to="/data" className="flex items-center justify-center rounded border border-border px-2 py-2 text-[9px] text-primary transition-colors hover:bg-elevated">
        OPEN NISAR SCIENCE DATA EXPLORER
      </Link>
      <p className="px-1 text-[8px] leading-relaxed text-subtle">
        Catalog records and public event context are source-attributed. Derived change, flood, fire, and deformation products remain unavailable until real processing exists.
      </p>
    </div>
  );
}

export function LayerPanel({ onCollapse }: { onCollapse?: () => void } = {}) {
  const mode = useApp((s) => s.mode);
  const setMode = useApp((s) => s.setMode);
  const advanced = useApp((s) => s.advanced);
  const setAdvanced = useApp((s) => s.setAdvanced);
  const liveEnabled = useApp(
    (s) => s.layers.has("live-usgs") || s.layers.has("live-eonet"),
  );
  const liveStatus = useApp((s) => s.liveDataStatus);
  const liveEvents = useApp((s) => s.liveEvents);
  const liveUpdatedAt = useApp((s) => s.liveDataUpdatedAt);
  const liveDataError = useApp((s) => s.liveDataError);
  const refreshLiveData = useApp((s) => s.refreshLiveData);
  const nisarStatus = useApp((s) => s.nisarStatus);
  const nisarError = useApp((s) => s.nisarError);
  const nisarGranules = useApp((s) => s.nisarGranules);
  const nisarPage = useApp((s) => s.nisarPage);
  const nisarHasMore = useApp((s) => s.nisarHasMore);
  const nisarMappedGranuleCount = useApp(
    (s) => s.nisarGranules.filter((granule) => Boolean(granule.bounds)).length,
  );
  const nisarGranuleHits = useApp((s) => s.nisarGranuleHits);
  const nisarGranuleHitsByProduct = useApp((s) => s.nisarGranuleHitsByProduct);
  const nisarGranuleStatusByProduct = useApp((s) => s.nisarGranuleStatusByProduct);
  const nisarSelectedProductCodes = useApp((s) => s.nisarSelectedProductCodes);
  const nisarCollections = useApp((s) => s.nisarCollections);
  const nisarLod = useApp((s) => s.lod);
  const refreshNISARData = useApp((s) => s.refreshNISARData);
  const workflowId = useApp((s) => s.activeIntelligenceWorkflowId);
  const planetaryComputerResult = useApp((s) => s.planetaryComputerResult);
  const planetaryComputerStatus = useApp((s) => s.planetaryComputerStatus);
  const planetaryComputerError = useApp((s) => s.planetaryComputerError);
  const refreshPlanetaryComputer = useApp((s) => s.refreshPlanetaryComputer);
  const productCounts = new Map<string, number>();
  for (const granule of nisarGranules) {
    productCounts.set(granule.productCode, (productCounts.get(granule.productCode) ?? 0) + 1);
  }

  const changeProduct = (product: string, enabled: boolean): boolean => {
    const selected = useApp.getState().nisarSelectedProductCodes;
    const next = enabled
      ? [...new Set([...selected, product])]
      : selected.filter((code) => code !== product);
    // Keep at least one product family selected so the catalogue never silently
    // remains on the previous query while the UI suggests everything is disabled.
    if (!next.length) return false;
    void refreshNISARData(next);
    return true;
  };

  useEffect(() => {
    if (liveEnabled && liveStatus === "idle") void refreshLiveData();
  }, [liveEnabled, liveStatus, refreshLiveData]);
  return (
    <div className="glass flex h-full min-h-0 w-[304px] flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <div>
          <div className="font-mono text-[9px] tracking-[0.18em] text-primary">
            EARTH INTELLIGENCE
          </div>
          <div className="mt-0.5 text-[12px] font-medium">Map layers</div>
        </div>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            className="rounded p-1 text-subtle hover:bg-elevated hover:text-foreground"
            aria-label="Collapse layers panel"
            title="Collapse layers panel"
          >
            <PanelLeftClose className="size-4" />
          </button>
        )}
      </div>
      <div className="mx-3 mb-2 mt-3 grid grid-cols-2 gap-1 rounded-md border border-border bg-background/35 p-1 font-mono text-[9px] tracking-[0.12em]">
        {(["intelligence", "science"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={cn(
              "rounded-[4px] py-2 uppercase transition-colors",
              mode === m
                ? "bg-elevated text-primary shadow-sm"
                : "text-subtle hover:text-foreground",
            )}
          >
            {m === "intelligence" ? "Workflows" : "Data layers"}
          </button>
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {mode === "intelligence" ? (
          <IntelligenceWorkspace />
        ) : (
          <div className="space-y-1">
            <p className="rounded border border-border/70 bg-background/30 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
              One shared map. These controls set source visibility for both tabs. Different catalogs can cover the same place; switch sources off to compare. Catalog footprints are not detections.
            </p>
            <Section title="NASA GPM precipitation">
              <Row id="gpm-imerg" label="IMERG precipitation rate" swatch="#55B9FF" tag="LIVE" />
              <p className="px-2 text-[9px] leading-relaxed text-muted-foreground">
                Latest available daily NASA GPM IMERG rain/snow-rate visualization (mm/hr). Approx. 0.1° source grid; not a forecast, accumulation, or flood classification.
              </p>
            </Section>
            <Section title="NASA NISAR catalog">
              <Row
                id="nisar-coverage"
                label="NISAR acquisition coverage"
                swatch="#2EC4FF"
                tag="CATALOG"
                onToggle={(enabled) => {
                  const app = useApp.getState();
                  app.toggleLayer("nisar-coverage", enabled);
                  if (enabled && app.nisarStatus !== "loading" && !app.nisarGranules.length) {
                    void app.refreshNISARData([...NISAR_COVERAGE_PRODUCT_CODES]);
                  }
                }}
              />
              <p className="px-2 text-[9px] leading-relaxed text-muted-foreground">
                Product families filter CMR records; coverage dots and footprints show acquisition locations, not radar pixels.
              </p>
              {NISAR_COVERAGE_PRODUCT_CODES.map((p) => (
                <div key={p}>
                  <Row
                    id={`prod-${p}`}
                    label={p}
                    swatch={nisarProductColor(p)}
                    disabled={nisarStatus === "loading"}
                    onToggle={(enabled) => {
                      if (!changeProduct(p, enabled)) return;
                      useApp.getState().toggleLayer(`prod-${p}`, enabled);
                    }}
                  />
                  <p className="px-2 pb-1 text-[10px] text-muted-foreground">
                    {nisarGranuleStatusByProduct[p] === "error"
                      ? "Search failed for this family"
                      : nisarGranuleStatusByProduct[p] === "no-collection"
                        ? "No collection for this date range"
                        : nisarGranuleStatusByProduct[p] === "ready"
                          ? `${productCounts.get(p) ?? 0} loaded · ${(nisarGranuleHitsByProduct[p] ?? 0).toLocaleString()} CMR matches`
                          : "Not searched"}
                  </p>
                </div>
              ))}
              <p className="px-2 text-[10px] text-subtle">
                {nisarSelectedProductCodes.length} of {NISAR_COVERAGE_PRODUCT_CODES.length} product families selected.
              </p>
              <div className="mx-2 mt-2 rounded-md border border-border bg-background/40 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="label-xs">NASA CMR STATUS</span>
                  <span
                    className={cn(
                      "font-mono text-[9px]",
                      nisarStatus === "ready"
                        ? "text-ok"
                        : nisarStatus === "partial" || nisarStatus === "error"
                          ? "text-amber"
                          : "text-subtle",
                    )}
                  >
                    {nisarStatus.toUpperCase()}
                  </span>
                </div>
                <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                  {nisarGranules.length} granules loaded ·{" "}
                  {nisarGranuleHits.toLocaleString()} matches ·{" "}
                  {nisarCollections.length} collections in catalog.
                </p>
                <p className="mt-1.5 text-[10px] leading-relaxed text-subtle">
                  {nisarLod === "global"
                    ? `${nisarMappedGranuleCount} loaded records have map extents. Global matches are paged; use Load more to inspect additional source records.`
                    : `${nisarMappedGranuleCount} of ${nisarGranules.length} loaded granules have usable CMR bounds; loaded records may be fewer than the reported hit count.`}
                </p>
                {nisarError && (
                  <p
                    role="status"
                    className="mt-1 text-[10px] leading-relaxed text-amber"
                  >
                    {nisarError}
                  </p>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 h-7 w-full text-[10px]"
                  disabled={nisarStatus === "loading"}
                  onClick={() => void refreshNISARData()}
                >
                  {nisarStatus === "loading"
                    ? "SEARCHING NASA CMR…"
                    : "REFRESH SELECTED PRODUCTS"}
                </Button>
                <Button
                  size="sm"
                  className="mt-1 h-7 w-full text-[10px]"
                  disabled={nisarStatus === "loading"}
                  onClick={() => {
                    useApp.getState().toggleLayer("nisar-coverage", true);
                    void refreshNISARData([...NISAR_COVERAGE_PRODUCT_CODES]);
                  }}
                >
                  {nisarStatus === "loading"
                    ? "SEARCHING ALL NISAR FAMILIES…"
                    : `SEARCH ALL ${NISAR_COVERAGE_PRODUCT_CODES.length} NISAR FAMILIES`}
                </Button>
                {nisarHasMore && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-1 h-7 w-full text-[10px]"
                    disabled={nisarStatus === "loading"}
                    onClick={() => void refreshNISARData(undefined, nisarPage + 1, true)}
                  >
                    {nisarStatus === "loading" ? "LOADING MORE RECORDS…" : `LOAD NEXT 100 PER PRODUCT · PAGE ${nisarPage + 1}`}
                  </Button>
                )}
                <Link
                  to="/data"
                  className="mt-2 block text-center text-[10px] text-primary hover:underline"
                >
                  OPEN FULL DATA EXPLORER ↗
                </Link>
              </div>
            </Section>
            <Section title="Planetary Computer catalog">
              <Row
                id="planetary-observations"
                label="Satellite catalog observations"
                swatch="#E9A66F"
                tag="CATALOG"
                onToggle={(enabled) => {
                  const app = useApp.getState();
                  app.toggleLayer("planetary-observations", enabled);
                  const hasCurrentSearch = app.planetaryComputerResult?.workflowId === workflowId;
                  if (enabled && (!hasCurrentSearch || app.planetaryComputerStatus === "error") &&
                    app.planetaryComputerStatus !== "loading") {
                    void refreshPlanetaryComputer(workflowId);
                  }
                }}
              />
              <p className="px-2 py-1 text-[10px] leading-relaxed text-muted-foreground">
                Real STAC items are searched for the selected workflow; this is a bounded catalog sample, not a complete archive.
              </p>
              <div className="mx-2 my-1 rounded border border-border/70 bg-background/30 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
                {planetaryComputerStatus === "loading"
                  ? "Searching Microsoft Planetary Computer…"
                  : planetaryComputerStatus === "error"
                    ? planetaryComputerError ?? "Planetary Computer search failed."
                    : planetaryComputerResult
                      ? `${planetaryComputerResult.items.length} records loaded · ${planetaryComputerResult.matched === null ? "total matches not reported" : `${planetaryComputerResult.matched.toLocaleString()} matches`}`
                      : "No search has been run for this workflow yet."}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mx-2 mt-1 h-7 w-[calc(100%-1rem)] text-[10px]"
                disabled={planetaryComputerStatus === "loading"}
                onClick={() => void refreshPlanetaryComputer(workflowId)}
              >
                {planetaryComputerStatus === "loading" ? "SEARCHING STAC CATALOGS…" : "SEARCH CURRENT WORKFLOW"}
              </Button>
              <ScientificResultLayer />
              <GuestNISARResultLayer />
            </Section>
            <Section title="Public event reports">
              <Row
                id="live-usgs"
                label="USGS earthquakes · M5+ / 2 y"
                swatch="#a98bff"
                tag="LIVE"
                onToggle={(enabled) => {
                  const app = useApp.getState();
                  app.toggleLayer("live-usgs", enabled);
                  if (enabled && app.liveDataStatus !== "loading" && app.liveProviderStatus.usgs.status !== "ready") {
                    void app.refreshLiveData();
                  }
                }}
              />
              <Row
                id="live-eonet"
                label="NASA EONET · 2 y sample (250 max)"
                swatch="#4fbf6a"
                tag="LIVE"
                onToggle={(enabled) => {
                  const app = useApp.getState();
                  app.toggleLayer("live-eonet", enabled);
                  if (enabled && app.liveDataStatus !== "loading" && app.liveProviderStatus.eonet.status !== "ready") {
                    void app.refreshLiveData();
                  }
                }}
              />
              <div className="mx-2 mt-2 rounded-md border border-border bg-background/40 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="label-xs">FEED STATUS</span>
                  <span
                    className={cn(
                      "font-mono text-[9px]",
                      liveStatus === "ready"
                        ? "text-ok"
                        : liveStatus === "partial" || liveStatus === "error"
                          ? "text-amber"
                          : "text-subtle",
                    )}
                  >
                    {liveStatus === "idle"
                      ? "NOT LOADED"
                      : liveStatus === "loading"
                        ? "FETCHING"
                        : liveStatus === "ready"
                          ? "FEEDS LOADED"
                          : liveStatus === "partial"
                            ? "PARTIAL"
                            : "UNAVAILABLE"}
                  </span>
                </div>
                <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                  {liveStatus === "ready"
                    ? `${liveEvents.length} records · updated ${liveUpdatedAt?.replace("T", " ").slice(0, 16) ?? "just now"} UTC`
                    : liveStatus === "loading"
                      ? "Fetching public records from USGS and NASA EONET."
                      : liveStatus === "error"
                        ? (liveDataError ??
                          "No live records are available. Check your connection.")
                        : liveStatus === "partial"
                          ? (liveDataError ??
                            `${liveEvents.length} records retained; one source may be unavailable.`)
                          : "Toggle a live layer to fetch public records. These are not NISAR measurements."}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 h-7 w-full text-[10px]"
                  disabled={liveStatus === "loading"}
                  onClick={() => void refreshLiveData()}
                >
                  {liveStatus === "loading"
                    ? "FETCHING SOURCES…"
                    : "REFRESH LIVE FEEDS"}
                </Button>
              </div>
            </Section>
            {advanced && (
              <Section title="Advanced">
                <p className="px-2 py-2 text-[10px] leading-relaxed text-muted-foreground">
                  Product-level polarization, orbit, quality, and resolution
                  filters are unavailable until source product metadata is
                  loaded for the current search.
                </p>
              </Section>
            )}
          </div>
        )}
      </div>
      {mode === "science" && (
        <button
          onClick={() => setAdvanced(!advanced)}
          className="flex items-center justify-between border-t border-border px-3 py-2.5 text-[12px] text-muted-foreground hover:text-foreground"
        >
          Advanced controls
          <span
            className={cn(
              "h-3.5 w-6 rounded-full border border-border p-px transition-colors",
              advanced && "border-primary",
            )}
          >
            <span
              className={cn(
                "block size-2.5 rounded-full bg-subtle transition-transform",
                advanced && "translate-x-2.5 bg-primary",
              )}
            />
          </span>
        </button>
      )}
    </div>
  );
}
