import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { EarthControls, FirstUseGuide, SignificanceControls } from "@/components/te/EarthControls";
import { Layers, Scan, PanelLeftOpen, X, Microscope } from "lucide-react";
import { useApp } from "@/lib/store";
import { LayerPanel } from "@/components/te/LayerPanel";
import { ContextPanel } from "@/components/te/ContextPanel";
import { Timeline } from "@/components/te/Timeline";
import { CommandBar } from "@/components/te/CommandBar";
import { SearchBox } from "@/components/te/SearchBox";
import { Wordmark } from "@/components/te/Logo";
import { runCommand } from "@/lib/ai-agent";
import { cn } from "@/lib/utils";
import { AnalyzeFlow } from "@/components/te/AnalyzeFlow";
import { getIntelligenceWorkflow } from "@/lib/intelligence-workflows";
import { NISAR_COVERAGE_PRODUCT_CODES } from "@/lib/sar-registry";

const EarthGlobe = lazy(() => import("@/components/te/EarthGlobe"));
const EarthMap = lazy(() => import("@/components/te/EarthMap"));

export function ExploreScreen() {
  const earthMode = useApp(s => s.earthMode);
  const mode = useApp(s => s.mode);
  const workflowId = useApp(s => s.activeIntelligenceWorkflowId);
  const aoi = useApp(s => s.aoi);
  const timeStart = useApp(s => s.time.start);
  const timeEnd = useApp(s => s.time.end);
  const [panel, setPanel] = useState<"layers" | "context" | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [layersCollapsed, setLayersCollapsed] = useState(true);
  const [contextCollapsed, setContextCollapsed] = useState(true);
  const ai = useApp((s) => s.aiActive);
  const filter = useApp((s) => s.filter);
  const setFilter = useApp((s) => s.setFilter);
  const selectedId = useApp((s) => s.selectedId);
  const locationStatus = useApp((s) => s.locationStatus);
  const analysisOpen = useApp((s) => s.analysisOpen);
  const setAnalysisOpen = useApp((s) => s.setAnalysisOpen);
  const toggleMobilePanel = (next: "layers" | "context") => {
    setFiltersOpen(false);
    setPanel(current => current === next ? null : next);
  };
  useEffect(() => {
    const state = useApp.getState();
    if (state.layers.has("live-usgs") || state.layers.has("live-eonet")) {
      if (state.liveDataStatus === "idle") void state.refreshLiveData();
    }
  }, []);
  useEffect(() => {
    if (mode === "science") {
      const app = useApp.getState();
      app.toggleLayer("nisar-coverage", true);
      void app.refreshNISARData([...NISAR_COVERAGE_PRODUCT_CODES]);
      return;
    }
    const workflow = getIntelligenceWorkflow(workflowId);
    const app = useApp.getState();
    const selectedProducts = new Set(workflow.nisarProductCodes);
    for (const productCode of NISAR_COVERAGE_PRODUCT_CODES) {
      app.toggleLayer(`prod-${productCode}`, selectedProducts.has(productCode));
    }
    app.toggleLayer("nisar-coverage", true);
    void app.refreshNISARData([...workflow.nisarProductCodes]);
    void app.refreshPlanetaryComputer(workflowId);
  }, [mode, workflowId, aoi, timeStart, timeEnd]);
  useEffect(() => {
    if (!selectedId && locationStatus !== "ready") return;
    setContextCollapsed(false);
    if (window.innerWidth < 760) {
      setFiltersOpen(false);
      setPanel("context");
    }
  }, [locationStatus, selectedId]);
  return (
    <div className="earth-screen">
      <header className="earth-topbar">
        <div className="earth-identity-zone">
          <div className="earth-wordmark"><Wordmark /></div>
          <EarthControls />
        </div>
        <div className="earth-search"><SearchBox /></div>
        <div className="earth-top-actions">
          <Button size="sm" variant="outline" onClick={() => {
            setAnalysisOpen(true);
            setLayersCollapsed(true);
            setContextCollapsed(true);
            setPanel(null);
            setFiltersOpen(false);
          }} className="glass">
            <Microscope className="size-4" /> ANALYZE
          </Button>
          <button onClick={() => useApp.getState().setAIActive(!ai)} className={cn("glass flex h-9 items-center gap-2 px-3 font-mono text-[11px] tracking-[0.2em]", ai && "glow-cyan text-primary")}>
            <span className={cn("size-2 rounded-full bg-primary", ai && "animate-ai-pulse")} />AI
          </button>
        </div>
        <div className="earth-filter-zone"><SignificanceControls open={filtersOpen} onOpenChange={setFiltersOpen} /></div>
      </header>

      <section className="earth-map-viewport" aria-label="Interactive Earth map">
        <ClientOnly fallback={null}>
          <Suspense fallback={<div className="earth-loading label-xs">Initialising globe…</div>}>
            {earthMode === "3d" ? <EarthGlobe /> : <EarthMap />}
          </Suspense>
        </ClientOnly>

        {(filter.types || filter.region) && (
          <div className="earth-active-filter glass">
            FILTER: {[filter.types?.join(", "), filter.region].filter(Boolean).join(" · ").toUpperCase()}
            <button onClick={() => setFilter({ types: null, region: null })} className="text-primary">CLEAR</button>
          </div>
        )}

        <aside className="earth-left-zone" aria-label="Map controls and assistant">
          <div className={cn("earth-layer-zone", !layersCollapsed && "earth-layer-zone-expanded")}>
            {!layersCollapsed && <div className="desktop-layer-panel"><LayerPanel onCollapse={() => setLayersCollapsed(true)} /></div>}
            {layersCollapsed && <Button className="desktop-layer-reopen glass" size="sm" variant="outline" onClick={() => setLayersCollapsed(false)} aria-label="Open layers panel"><PanelLeftOpen className="size-4" /> Layers</Button>}
          </div>
          <div className="earth-agent-dock"><CommandBar /></div>
        </aside>

        <aside className="earth-right-zone" aria-label="Selected map details">
          {!contextCollapsed && <div className="desktop-context-panel">
            <div className="desktop-context-collapse-row">
              <Button size="icon" variant="outline" onClick={() => setContextCollapsed(true)} aria-label="Collapse details panel" title="Collapse details panel"><X className="size-4" /></Button>
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
              <ContextPanel />
            </div>
          </div>}
          {contextCollapsed && <Button className="desktop-context-reopen glass" size="icon" variant="outline" onClick={() => setContextCollapsed(false)} aria-label="Open details panel" title="Open details panel"><Scan className="size-4" /></Button>}
        </aside>

        <div className="mobile-panel-controls">
          <Button size="icon" variant="outline" aria-label="Open layers" aria-pressed={panel === "layers"} onClick={() => toggleMobilePanel("layers")}><Layers /></Button>
          <Button size="icon" variant="outline" aria-label="Open context" aria-pressed={panel === "context"} onClick={() => toggleMobilePanel("context")}><Scan /></Button>
        </div>
        {panel && <div className="mobile-earth-panel">{panel === "layers" ? <LayerPanel onCollapse={() => setPanel(null)} /> : <ContextPanel />}</div>}

        <FirstUseGuide />

        {analysisOpen && (
          <aside className="earth-analysis-panel glass" aria-label="Analysis tools">
            <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-medium"><Microscope className="size-4 text-primary" />Analysis tools</h2>
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">AOI discovery on this globe/map · no raster processing</p>
              </div>
              <Button size="icon" variant="ghost" className="size-7 shrink-0" aria-label="Close analysis tools" onClick={() => {
                setAnalysisOpen(false);
                useApp.getState().setDrawTool(null);
              }}><X className="size-4" /></Button>
            </header>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
              <AnalyzeFlow />
            </div>
          </aside>
        )}
      </section>

      <footer className="earth-bottom-zone">
        <div className="data-status-indicator">NASA CMR ACQUISITIONS · PUBLIC SOURCE EVENTS · NO DERIVED SCIENCE PRODUCTS</div>
        <div className="earth-timeline-dock"><Timeline /></div>
      </footer>
    </div>
  );
}
