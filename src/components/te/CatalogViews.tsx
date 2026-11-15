import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ClientOnly, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { DATASETS } from "@/lib/earth-data";
import { PHENOMENA } from "@/lib/earth-vocabulary";
import { useApp } from "@/lib/store";
import { INTELLIGENCE_WORKFLOWS, type IntelligenceWorkflowId } from "@/lib/intelligence-workflows";

const EarthMap = lazy(() => import("./EarthMap"));
const EarthGlobe = lazy(() => import("./EarthGlobe"));

export function ObservationCatalog() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [product, setProduct] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const granules = useApp(state => state.nisarGranules);
  const hits = useApp(state => state.nisarGranuleHits);
  const status = useApp(state => state.nisarStatus);
  const error = useApp(state => state.nisarError);
  const updatedAt = useApp(state => state.nisarUpdatedAt);
  const refresh = useApp(state => state.refreshNISARData);
  const autoRefreshRequested = useRef(false);
  useEffect(() => {
    const isStale = updatedAt !== null && Date.now() - Date.parse(updatedAt) > 15 * 60_000;
    if (!autoRefreshRequested.current && (status === "idle" || (status !== "loading" && isStale))) {
      autoRefreshRequested.current = true;
      void refresh();
    }
  }, [status, updatedAt, refresh]);
  const rows = granules.filter(granule => {
    const day = (granule.startDate || "").slice(0, 10);
    return (!query || `${granule.granuleId} ${granule.productCode} ${granule.collectionShortName}`.toLowerCase().includes(query.toLowerCase()))
      && (!product || granule.productCode === product)
      && (!start || (day && day >= start))
      && (!end || (day && day <= end));
  }).sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));

  return (
    <section className="scientific-band">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="label-xs text-primary">NASA CMR · LIVE CATALOG METADATA</div>
          <h2 className="mt-2 text-lg">NISAR acquisition records</h2>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            These are source records and catalog footprints, not processed radar measurements. A browse image is a preview, not the full product raster.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="font-mono text-[10px] text-muted-foreground">{status.toUpperCase()} · {rows.length} SHOWN / {granules.length} LOADED / {hits.toLocaleString()} CMR MATCHES</div>
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={status === "loading"}>
            {status === "loading" ? "REFRESHING…" : "REFRESH RECENT DATA"}
          </Button>
        </div>
      </div>
      {updatedAt && <p className="mt-2 text-[10px] text-subtle">NASA CMR checked {updatedAt.replace("T", " ").slice(0, 16)} UTC. Newest acquisitions are listed first.</p>}
      {error && <p role="status" className="mt-3 text-xs text-amber">{error}</p>}
      <div className="my-4 flex flex-wrap gap-2">
        <input aria-label="Search NISAR granules" placeholder="Granule or collection ID" value={query} onChange={event => setQuery(event.target.value)} className="instrument-input" />
        <select aria-label="NISAR product" value={product} onChange={event => setProduct(event.target.value)} className="instrument-select">
          <option value="">All products</option>
          {DATASETS.filter(dataset => dataset.group === "PRIMARY").map(dataset => <option key={dataset.id} value={dataset.id}>{dataset.id}</option>)}
        </select>
        <input aria-label="Acquisition start date" type="date" value={start} onChange={event => setStart(event.target.value)} className="instrument-input" />
        <input aria-label="Acquisition end date" type="date" value={end} onChange={event => setEnd(event.target.value)} className="instrument-input" />
      </div>
      {rows.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.slice(0, 24).map(granule => (
            <article key={granule.conceptId} className="flex min-w-0 gap-3 rounded-lg border border-border bg-background/30 p-3">
              {granule.browseUrl ? (
                <a href={granule.browseUrl} target="_blank" rel="noopener noreferrer" className="block h-24 w-28 shrink-0 overflow-hidden rounded border border-border bg-background">
                  <img src={granule.browseUrl} alt={`NISAR ${granule.productCode} browse preview`} loading="lazy" className="h-full w-full object-contain" onError={event => { event.currentTarget.style.display = "none"; }} />
                </a>
              ) : <div className="flex h-24 w-28 shrink-0 items-center justify-center rounded border border-border bg-background font-mono text-[9px] text-subtle">NO PREVIEW</div>}
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[10px] text-primary">{granule.productCode} · {granule.startDate?.slice(0, 10) ?? "DATE N/A"} · {granule.maturity.toUpperCase()}</div>
                <div className="mt-1 break-all text-[10px] leading-snug">{granule.granuleId}</div>
                <div className="mt-2 flex flex-wrap gap-3">
                  <Link to="/observations/$id" params={{ id: granule.id }} className="text-[11px] text-primary hover:underline">Inspect metadata</Link>
                  <a href={granule.earthdataSearchUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary hover:underline">Earthdata ↗</a>
                  <button type="button" onClick={() => { useApp.getState().select(granule.id); void navigate({ to: "/dashboard" }); }} className="text-[11px] text-primary hover:underline">View footprint</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
          {status === "loading" ? "Searching NASA CMR for real NISAR catalog records…" : status === "error" ? "NASA CMR metadata could not be loaded. Retry the catalog query." : "No matching NISAR acquisitions are loaded for these filters."}
        </div>
      )}
      <p className="mt-3 font-mono text-[9px] leading-relaxed text-subtle">SOURCE: NASA CMR / ASF DAAC · MAP FOOTPRINTS ARE CATALOG SPATIAL EXTENTS · FULL PRODUCT ACCESS MAY REQUIRE EARTHDATA LOGIN</p>
    </section>
  );
}

export function EventCatalog() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"LIST" | "MAP" | "GLOBE">("LIST");
  const [query, setQuery] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const liveEvents = useApp(state => state.liveEvents);
  const layers = useApp(state => state.layers);
  const filter = useApp(state => state.filter);
  const time = useApp(state => state.time);
  const status = useApp(state => state.liveDataStatus);
  const rows = liveEvents.filter(event => {
    const day = event.date.slice(0, 10);
    return layers.has(event.layerId)
      && (!filter.types || filter.types.includes(event.type))
      && (!filter.region || `${event.region} ${event.country}`.toLowerCase().includes(filter.region.toLowerCase()))
      && day >= time.start && day <= time.end && day <= time.current
      && (!start || day >= start) && (!end || day <= end)
      && `${event.title} ${event.region} ${event.source}`.toLowerCase().includes(query.toLowerCase());
  });

  return (
    <>
      <div className="mb-5 flex flex-wrap gap-2">
        {(["LIST", "MAP", "GLOBE"] as const).map(view => <Button key={view} size="sm" variant={mode === view ? "secondary" : "ghost"} onClick={() => setMode(view)}>{view}</Button>)}
        <input aria-label="Search source-reported events" placeholder="Event or geography" value={query} onChange={event => setQuery(event.target.value)} className="instrument-input" />
        <select aria-label="Event category" className="instrument-select" value={filter.types?.[0] ?? ""} onChange={event => useApp.getState().setFilter({ types: event.target.value ? [event.target.value as (typeof PHENOMENA)[number]["id"]] : null })}>
          <option value="">All categories</option>
          {PHENOMENA.map(phenomenon => <option key={phenomenon.id} value={phenomenon.id}>{phenomenon.label}</option>)}
        </select>
        <input aria-label="Event start date" type="date" value={start} onChange={event => setStart(event.target.value)} className="instrument-input" />
        <input aria-label="Event end date" type="date" value={end} onChange={event => setEnd(event.target.value)} className="instrument-input" />
      </div>
      {mode === "LIST" ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead><tr>{["Source event", "Location", "Date", "Source", "Status"].map(header => <th key={header} scope="col" className="label-xs border-b border-border py-3">{header}</th>)}</tr></thead>
            <tbody>{rows.map(event => (
              <tr key={event.id} className="border-b border-border hover:bg-elevated">
                <td className="py-3"><Button variant="link" className="h-auto px-0 text-xs" onClick={() => { useApp.getState().select(event.id); void navigate({ to: "/dashboard" }); }}>{event.title}</Button></td>
                <td>{event.region}</td><td>{event.date.slice(0, 10)}</td><td>{event.sourceLabel}</td><td>Source-reported</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div className="relative h-[540px]">
          <ClientOnly fallback={<div className="label-xs p-5">LOADING EARTH</div>}>
            <Suspense fallback={<div className="label-xs p-5">LOADING EARTH</div>}>
              {mode === "MAP" ? <EarthMap compact /> : <EarthGlobe />}
            </Suspense>
          </ClientOnly>
        </div>
      )}
      {!rows.length && mode === "LIST" && (
        <p className="my-5 text-sm text-muted-foreground">
          {status === "loading" ? "Loading source-reported public events…" : "No source-reported events match the current filters. Enable a connected public-event layer or refresh its feed."}
        </p>
      )}
      <p className="mt-4 font-mono text-[9px] leading-relaxed text-subtle">PUBLIC-SOURCE REPORTS ARE CONTEXT ONLY; THEY ARE NOT NISAR MEASUREMENTS OR THIRD EYE DETECTIONS.</p>
    </>
  );
}

export function PlanetaryComputerCatalog() {
  const navigate = useNavigate();
  const workflowId = useApp(state => state.activeIntelligenceWorkflowId);
  const setWorkflowId = useApp(state => state.setActiveIntelligenceWorkflow);
  const result = useApp(state => state.planetaryComputerResult);
  const status = useApp(state => state.planetaryComputerStatus);
  const error = useApp(state => state.planetaryComputerError);
  const refresh = useApp(state => state.refreshPlanetaryComputer);
  const time = useApp(state => state.time);
  const aoi = useApp(state => state.aoi);
  const activeResult = result?.workflowId === workflowId ? result : null;
  const autoRequestedFor = useRef<IntelligenceWorkflowId | null>(null);

  useEffect(() => {
    if (!activeResult && status !== "loading" && autoRequestedFor.current !== workflowId) {
      autoRequestedFor.current = workflowId;
      void refresh(workflowId);
    }
  }, [activeResult, status, workflowId, refresh]);

  const showOnMap = (id: string) => {
    useApp.getState().select(id);
    void navigate({ to: "/dashboard" });
  };

  return (
    <section className="scientific-band">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="label-xs text-amber">MICROSOFT PLANETARY COMPUTER · LIVE STAC SEARCH</div>
          <h2 className="mt-2 text-lg">Complementary satellite observations</h2>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            Real Sentinel, Landsat, and MODIS catalog items for the selected workflow, area, and timeline. These are acquisition metadata and footprints, not derived analysis.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void refresh(workflowId)} disabled={status === "loading"}>
          {status === "loading" ? "SEARCHING STAC…" : "REFRESH OBSERVATIONS"}
        </Button>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-[10px] text-muted-foreground">
          Observation goal
          <select
            aria-label="Planetary Computer observation workflow"
            value={workflowId}
            onChange={event => setWorkflowId(event.target.value as IntelligenceWorkflowId)}
            className="instrument-select"
          >
            {INTELLIGENCE_WORKFLOWS.map(workflow => <option key={workflow.id} value={workflow.id}>{workflow.label}</option>)}
          </select>
        </label>
        <p className="text-[10px] text-subtle">
          {aoi ? `Area: ${aoi.name}` : "Area: global"} · {time.start} to {time.current < time.end ? time.current : time.end}
        </p>
      </div>
      {status === "loading" && !activeResult && <p role="status" className="mt-4 text-xs text-muted-foreground">Querying the selected real STAC collections…</p>}
      {error && <p role="status" className="mt-3 text-xs text-amber">{error}</p>}
      {activeResult && (
        <>
          <div className="mt-4 flex flex-wrap justify-between gap-2 font-mono text-[10px] text-muted-foreground">
            <span>{activeResult.items.length} mapped items{activeResult.matched !== null ? ` · ${activeResult.matched.toLocaleString()} matching records reported` : ""}</span>
            <span>UPDATED {activeResult.fetchedAt.replace("T", " ").slice(0, 16)} UTC · {activeResult.startDate} — {activeResult.endDate}</span>
          </div>
          {activeResult.warnings.map(warning => <p key={warning} className="mt-2 text-[10px] text-amber">{warning}</p>)}
          {activeResult.items.length ? (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {activeResult.items.map(item => (
                <article key={item.id} className="rounded-lg border border-border bg-background/30 p-3">
                  <button type="button" onClick={() => showOnMap(item.id)} className="block w-full text-left hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary">
                    <span className="font-mono text-[9px] text-amber">{item.collectionLabel} · {item.datetime?.slice(0, 10) ?? "DATE NOT REPORTED"}</span>
                    <span className="mt-1 block text-sm font-medium">{item.platform ?? item.title}</span>
                    <span className="mt-1 block break-all font-mono text-[9px] text-subtle">{item.id.replace(/^pc:[^:]+:/, "")}</span>
                    <span className="mt-2 block text-[10px] text-primary">SHOW FOOTPRINT AND DETAILS ON MAP →</span>
                  </button>
                  {item.previewUrl && <a href={item.previewUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[10px] text-primary hover:underline">Open interactive provider preview ↗</a>}
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-3 rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
              {activeResult.matched === 0 ? "No items matched these collections, dates, and area." : "The provider returned no displayable items for this search."}
            </p>
          )}
          <p className="mt-3 font-mono text-[9px] leading-relaxed text-subtle">SOURCE: MICROSOFT PLANETARY COMPUTER STAC · CATALOG METADATA ONLY · IMAGERY MUST BE VERIFIED BEFORE IT CAN BE SHOWN</p>
        </>
      )}
    </section>
  );
}

export function DiscoverFindings() {
  return (
    <section className="scientific-band">
      <div className="label-xs text-amber">NO PROCESSED SCIENTIFIC PRODUCTS</div>
      <p className="mt-2 text-sm text-muted-foreground">
        This deployment does not download or process NISAR rasters, so it has no derived change, flood, deformation, or other detection results to display.
      </p>
    </section>
  );
}
