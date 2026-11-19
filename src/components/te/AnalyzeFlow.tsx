import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/store";
import { makeAOI, rectangleAOI, validateGeometry, type DrawTool } from "@/lib/analysis";
import {
  isNISARCoverageProductCode,
  NISAR_COVERAGE_PRODUCT_CODES,
  NISAR_PRODUCTS,
} from "@/lib/sar-registry";
import { Check, Upload, Eraser, MapPin, Circle, Pentagon, Square, Scan, MousePointer2 } from "lucide-react";

const STEPS = ["AREA", "DATA", "TIME", "SEARCH", "RESULT"];
const DRAW_TOOLS: Array<{ id: DrawTool; label: string; icon: typeof Pentagon }> = [
  { id: "polygon", label: "POLYGON", icon: Pentagon },
  { id: "rectangle", label: "RECTANGLE", icon: Square },
  { id: "circle", label: "CIRCLE", icon: Circle },
  { id: "point", label: "POINT", icon: MapPin },
];

export function AnalyzeFlow() {
  const [step, setStep] = useState(0);
  const [datasets, setDatasets] = useState<string[]>(["GCOV"]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [resultId, setResultId] = useState<string | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const aoi = useApp(state => state.aoi);
  const drawTool = useApp(state => state.drawTool);
  const drawingPoints = useApp(state => state.drawingPoints);
  const drawingError = useApp(state => state.drawingError);
  const earthMode = useApp(state => state.earthMode);
  const result = useApp(state => state.analyses.find(item => item.id === resultId));

  const selectTool = (tool: DrawTool) => {
    useApp.getState().setDrawTool(drawTool === tool ? null : tool);
    setError("");
  };

  const useCurrentView = () => {
    const view = useApp.getState().view;
    const west = Math.max(-179.9, view.lng - 1);
    const east = Math.min(179.9, view.lng + 1);
    const south = Math.max(-89.5, view.lat - 1);
    const north = Math.min(89.5, view.lat + 1);
    try {
      useApp.getState().setAOI(rectangleAOI([west, south], [east, north]));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The current view could not be used as an area.");
    }
  };

  const readUpload = async (file: File) => {
    try {
      if (file.size > 2_000_000) throw new Error("Area files must be smaller than 2 MB.");
      const text = await file.text();
      let input: unknown;
      if (file.name.toLowerCase().endsWith(".kml")) {
        const { kml } = await import("@tmcw/togeojson");
        input = kml(new DOMParser().parseFromString(text, "text/xml"));
      } else {
        input = JSON.parse(text) as unknown;
      }
      const importedAOI = makeAOI(validateGeometry(input), file.name);
      useApp.getState().setAOI(importedAOI);
      const extent = Math.max(importedAOI.bounds[2]! - importedAOI.bounds[0]!, importedAOI.bounds[3]! - importedAOI.bounds[1]!);
      useApp.getState().flyTo({
        lat: importedAOI.center.lat,
        lng: importedAOI.center.lng,
        altitude: Math.max(0.002, Math.min(1.5, extent / 30 || 0.12)),
      });
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The area file could not be read.");
    }
  };

  const run = async () => {
    if (!aoi || !start || !end || start > end) {
      setError("Choose an area and valid dates.");
      return;
    }
    const productCodes = datasets.filter(isNISARCoverageProductCode);
    if (!productCodes.length) {
      setError(`Select at least one supported NISAR product family: ${NISAR_COVERAGE_PRODUCT_CODES.join(", ")}.`);
      return;
    }

    setRunning(true);
    setError("");
    try {
      const app = useApp.getState();
      app.setTimeRange({ start, end });
      app.setCurrentDate(end);
      app.setNISARProductSelection(productCodes);
      app.toggleLayer("nisar-coverage", true);
      productCodes.forEach(code => app.toggleLayer(`prod-${code}`, true));
      await app.refreshNISARData(productCodes);
      const refreshed = useApp.getState();
      if (refreshed.nisarStatus === "error") {
        throw new Error(refreshed.nisarError || "NASA CMR catalog search failed.");
      }
      const matchedGranules = refreshed.nisarGranules.filter(granule => {
        const date = granule.startDate?.slice(0, 10) ?? "";
        return date >= start && date <= end;
      });
      if (!matchedGranules.length) {
        throw new Error("NASA CMR returned no NISAR records for this area, product, and date range. No sample analysis was generated.");
      }
      const id = `LIVE-CMR-${Date.now()}`;
      app.addAnalysis({
        id,
        aoi,
        datasets,
        start,
        end,
        kind: "Catalog discovery",
        provenance: "live-catalog",
        matchedGranules,
        catalogWarnings: refreshed.nisarError ? [refreshed.nisarError] : [],
      });
      setResultId(id);
      setStep(4);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "NASA CMR search failed. No analysis result was fabricated.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <nav aria-label="Analysis steps" className="flex flex-wrap gap-1">
        {STEPS.map((label, index) => (
          <Button key={label} variant={index === step ? "secondary" : "ghost"} size="sm" disabled={index > step} onClick={() => setStep(index)}>
            {index < step ? <Check /> : index + 1}{label}
          </Button>
        ))}
      </nav>

      {step === 0 && (
        <section className="space-y-3">
          <div className="label-xs text-primary">DRAW ON THE ACTIVE {earthMode === "3d" ? "3D GLOBE" : "2D MAP"}</div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Choose a shape, then click the visible Earth outside this panel. The same AOI will appear on the map and scope provider searches.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {DRAW_TOOLS.map(({ id, label, icon: Icon }) => (
              <Button key={id} size="sm" variant={drawTool === id ? "secondary" : "outline"} aria-pressed={drawTool === id} onClick={() => selectTool(id)}>
                <Icon />{label}
              </Button>
            ))}
            <Button size="sm" variant="outline" onClick={useCurrentView}><Scan />USE CURRENT VIEW</Button>
            <Button size="sm" variant="outline" onClick={() => upload.current?.click()}><Upload />GEOJSON / KML</Button>
            <Button size="sm" variant="ghost" onClick={() => { useApp.getState().setDrawTool(null); useApp.getState().setAOI(null); }}><Eraser />CLEAR</Button>
            <input ref={upload} type="file" className="hidden" accept=".geojson,.json,.kml" onChange={event => {
              const file = event.currentTarget.files?.[0];
              if (file) void readUpload(file);
              event.currentTarget.value = "";
            }} />
          </div>
          {drawTool && (
            <div className="rounded border border-primary/30 bg-primary/5 p-2 text-[11px] text-primary" role="status">
              <MousePointer2 className="mr-1 inline size-3" />
              {drawTool === "polygon"
                ? `Click at least three vertices on the Earth, then finish the polygon. ${drawingPoints.length} vertices selected.`
                : drawTool === "point"
                  ? "Click a location on the Earth to set a point AOI."
                  : drawTool === "circle"
                    ? `Click the center, then a point on the edge. ${drawingPoints.length}/2 points selected.`
                    : `Click two opposite corners on the Earth. ${drawingPoints.length}/2 corners selected.`}
            </div>
          )}
          {drawTool === "polygon" && (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => useApp.getState().finishDrawing()} disabled={drawingPoints.length < 3}>FINISH POLYGON</Button>
              <Button size="sm" variant="ghost" onClick={() => useApp.getState().setDrawTool("polygon")}>RESET VERTICES</Button>
            </div>
          )}
          {drawingError && <p role="alert" className="text-xs text-alert">{drawingError}</p>}
          {aoi ? (
            <dl className="metadata-grid rounded border border-border bg-background/30 p-3">
              <div><dt>Area of interest</dt><dd>{aoi.name}</dd></div>
              <div><dt>Area</dt><dd>{aoi.areaKm2.toFixed(2)} km²</dd></div>
              <div><dt>Center</dt><dd>{aoi.center.lat.toFixed(4)}, {aoi.center.lng.toFixed(4)}</dd></div>
              <div><dt>Bounds</dt><dd>{aoi.bounds.map(value => value.toFixed(3)).join(", ")}</dd></div>
            </dl>
          ) : <p className="rounded border border-dashed border-border p-3 text-xs text-muted-foreground">No area selected. Search for a place or draw an AOI directly on the globe/map.</p>}
        </section>
      )}

      {step === 1 && (
        <section>
          <h2 className="label-xs mb-2">NASA CMR PRODUCT FAMILIES</h2>
          <p className="mb-3 text-xs text-muted-foreground">This searches real catalog metadata only; it does not download or process radar measurements.</p>
          <div className="grid gap-x-4 sm:grid-cols-2">
            {NISAR_PRODUCTS.filter(product => product.coverageSearch).map(product => (
              <label key={product.code} className="flex items-start gap-3 border-b border-border py-2 text-sm">
                <input type="checkbox" checked={datasets.includes(product.code)} onChange={() => setDatasets(current => current.includes(product.code) ? current.filter(code => code !== product.code) : [...current, product.code])} />
                <span>NISAR {product.code}<span className="mt-1 block font-mono text-[9px] text-amber">CMR SEARCH SUPPORTED</span></span>
              </label>
            ))}
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-4">
          <p className="text-xs text-muted-foreground">Choose the acquisition date range. No before/after raster analysis is run.</p>
          <div className="flex flex-wrap gap-2">
            {[30, 180, 365].map(days => (
              <Button key={days} variant="outline" size="sm" onClick={() => {
                const now = new Date();
                setEnd(now.toISOString().slice(0, 10));
                setStart(new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10));
              }}>Last {days === 365 ? "year" : `${days} days`}</Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="grid gap-1 text-xs">Start date<input aria-label="Analysis start" type="date" value={start} max={end || undefined} onChange={event => setStart(event.target.value)} className="instrument-input" /></label>
            <label className="grid gap-1 text-xs">End date<input aria-label="Analysis end" type="date" value={end} min={start || undefined} max={new Date().toISOString().slice(0, 10)} onChange={event => setEnd(event.target.value)} className="instrument-input" /></label>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="rounded border border-border bg-background/30 p-3">
          <div className="label-xs text-primary">LIVE CATALOG DISCOVERY</div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Search NASA CMR for {datasets.join(", ") || "no selected NISAR products"} over {aoi?.name ?? "no selected area"} from {start || "start date"} to {end || "end date"}. Matching footprints will be added to the active globe/map.
          </p>
        </section>
      )}

      {step === 4 && result && (
        <section className="rounded border border-border bg-background/30 p-3">
          <div className="label-xs text-primary">CATALOG DISCOVERY · NASA CMR</div>
          <p className="mt-2 text-sm font-medium">{result.aoi.name} · {result.matchedGranules?.length ?? 0} acquisition records</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">These are source catalog entries and footprints, not measured change or hazard results. Their footprints are now available on the active globe/map.</p>
          {result.catalogWarnings?.map(warning => <p key={warning} className="mt-2 text-xs text-amber">{warning}</p>)}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild size="sm"><Link to="/analysis/$id" params={{ id: result.id }}>OPEN DISCOVERY REPORT</Link></Button>
            <Button asChild size="sm" variant="outline"><Link to="/data">CONTINUE TO NISAR PROCESSING</Link></Button>
            <Button size="sm" variant="outline" onClick={() => setStep(0)}>EDIT AREA</Button>
          </div>
        </section>
      )}

      {error && <p role="alert" className="text-xs text-alert">{error}</p>}
      {step < 4 && (
        <div className="flex justify-between border-t border-border pt-3">
          <Button variant="outline" size="sm" disabled={step === 0 || running} onClick={() => setStep(step - 1)}>BACK</Button>
          <Button size="sm" disabled={running || (step === 0 && !aoi) || (step === 1 && !datasets.length) || (step === 2 && (!start || !end || start > end))} onClick={() => step === 3 ? void run() : setStep(step + 1)}>
            {running ? "SEARCHING NASA CMR…" : step === 3 ? "SEARCH LIVE NISAR DATA" : "CONTINUE"}
          </Button>
        </div>
      )}
    </div>
  );
}
