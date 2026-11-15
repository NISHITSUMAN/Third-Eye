import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, RefreshCw } from "lucide-react";
import { useApp } from "@/lib/store";
import { formatCoord } from "@/lib/earth-vocabulary";
import { ObservationCatalog, EventCatalog, DiscoverFindings, PlanetaryComputerCatalog } from "./CatalogViews";
import { AnalyzeFlow } from "./AnalyzeFlow";
import { ScienceLearn } from "./ScientificViews";
import { Panel } from "./PageShell";
import { NISARCatalog } from "./NISARCatalog";
import { OPERACatalog } from "./OPERACatalog";
import { cn } from "@/lib/utils";
import { NISAR_PRODUCTS } from "@/lib/sar-registry";
import {
  DEFAULT_VOICE_PREFERENCES,
  readVoicePreferences,
  VOICE_SETTINGS_EVENT,
  writeVoicePreferences,
  type VoicePreferences,
} from "@/lib/voice/voice-session";

function useOpen() {
  const nav = useNavigate();
  return (id: string) => { useApp.getState().setOnboarded(true); useApp.getState().select(id); nav({ to: "/" }); };
}

export function DiscoverBody() {
  const granules = useApp((state) => state.nisarGranules);
  const status = useApp((state) => state.nisarStatus);
  const error = useApp((state) => state.nisarError);
  const open = useOpen();
  return <div className="space-y-6">
    <section className="scientific-band">
      <div className="label-xs text-primary">REAL NASA NISAR ACQUISITIONS</div>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg">Recently catalogued products</h2><p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">These are real product records from NASA CMR. Footprints show catalog coverage; quicklook images are previews and are not analysed measurements or hazard predictions.</p></div>
        <span className="font-mono text-[10px] text-muted-foreground">{status.toUpperCase()} · {granules.length} PRODUCTS</span>
      </div>
      {error && <p role="status" className="mt-3 text-xs text-amber">{error}</p>}
      {granules.length ? <div className="mt-4 grid gap-3 md:grid-cols-2">
        {granules.slice(0, 12).map(granule => <article key={granule.conceptId} className="flex min-w-0 gap-3 rounded-lg border border-border bg-background/30 p-3">
          {granule.browseUrl ? <a href={granule.browseUrl} target="_blank" rel="noopener noreferrer" className="block h-24 w-28 shrink-0 overflow-hidden rounded border border-border bg-background"><img src={granule.browseUrl} alt={`NISAR ${granule.productCode} browse quicklook`} loading="lazy" className="h-full w-full object-contain" onError={event => { event.currentTarget.style.display = "none"; }} /></a> : <div className="flex h-24 w-28 shrink-0 items-center justify-center rounded border border-border bg-background font-mono text-[9px] text-subtle">NO PREVIEW</div>}
          <div className="min-w-0 flex-1"><div className="font-mono text-[10px] text-primary">{granule.productCode} · {granule.startDate?.slice(0,10) ?? "DATE N/A"} · {granule.maturity.toUpperCase()}</div><div className="mt-1 break-all text-[10px] leading-snug">{granule.granuleId}</div><div className="mt-2 flex flex-wrap gap-3 text-[11px]"><Link to="/observations/$id" params={{id:granule.id}} className="text-primary hover:underline">Inspect metadata</Link><button type="button" onClick={() => open(granule.id)} className="text-primary hover:underline">View footprint</button><a href={granule.earthdataSearchUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Earthdata ↗</a></div></div>
        </article>)}
      </div> : <p className="mt-4 rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">{status === "loading" ? "Searching NASA CMR for real NISAR acquisitions…" : "No browseable NISAR granules are currently loaded for the selected area and date range. Use Data Explorer to refresh or narrow the query."}</p>}
      <Link to="/data" className="mt-4 inline-block text-xs text-primary hover:underline">SEARCH COLLECTIONS AND GRANULES IN DATA EXPLORER ↗</Link>
    </section>
    <DiscoverFindings />
  </div>;
}

export function EventsBody() {
  const granules = useApp((state) => state.nisarGranules);
  const status = useApp((state) => state.nisarStatus);
  const open = useOpen();
  return <div className="space-y-6">
    <section className="scientific-band">
      <div className="label-xs text-primary">REAL SATELLITE ACQUISITIONS</div>
      <h2 className="mt-2 text-lg">NISAR observations near the selected time window</h2>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">These catalog records are real satellite acquisitions. They are not, by themselves, flood, fire, landslide or deformation events. Select a footprint to inspect its acquisition context.</p>
      <p className="mt-2 font-mono text-[10px] text-muted-foreground">{status.toUpperCase()} · {granules.length} GRANULES</p>
      {granules.length ? <div className="mt-3 grid gap-2 md:grid-cols-2">
        {granules.slice(0, 8).map(granule => <button key={granule.conceptId} type="button" onClick={() => open(granule.id)} className="flex min-w-0 items-start justify-between gap-3 rounded-md border border-border bg-background/30 p-3 text-left hover:bg-elevated"><div className="min-w-0"><div className="font-mono text-[10px] text-primary">{granule.productCode} · {granule.startDate?.slice(0,10) ?? "DATE N/A"} · {granule.maturity.toUpperCase()}</div><div className="mt-1 break-all text-xs">{granule.granuleId}</div></div><span className="shrink-0 text-[10px] text-primary">VIEW MAP ↗</span></button>)}
      </div> : <p className="mt-3 text-xs text-muted-foreground">{status === "loading" ? "Loading NASA catalog records…" : "No live NISAR granules are loaded for this window."}</p>}
    </section>
    <EventCatalog />
  </div>;
}

export const ObservationsBody = ObservationCatalog;

export function TimelineBody() {
  const open = useOpen();
  const time = useApp(state => state.time);
  const granules = useApp(state => state.nisarGranules);
  const nisarStatus = useApp(state => state.nisarStatus);
  const nisarError = useApp(state => state.nisarError);
  const liveEvents = useApp(state => state.liveEvents);
  const liveStatus = useApp(state => state.liveDataStatus);
  const start = time.start;
  const end = time.end;
  const current = time.current;
  const realGranules = granules.filter(granule => {
    const day = (granule.startDate || "").slice(0, 10);
    return day && day >= start && day <= end && day <= current;
  }).sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""));
  const publicEvents = liveEvents.filter(event => {
    const day = event.date.slice(0, 10);
    return day >= start && day <= end && day <= current;
  }).sort((a, b) => b.date.localeCompare(a.date));
  return <div className="space-y-6">
    <section className="scientific-band">
      <div className="label-xs text-primary">REAL SATELLITE ACQUISITIONS · NASA CMR / ASF</div>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg">NISAR acquisition timeline</h2><p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">Browse actual catalogued NISAR products within the selected time window. These are acquisition records and footprints, not inferred hazards or change-detection outputs.</p></div>
        <span className="font-mono text-[10px] text-muted-foreground">{nisarStatus.toUpperCase()} · {realGranules.length} SHOWN</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <label className="grid gap-1">FROM<input type="date" value={time.start} max={time.end} onChange={event => useApp.getState().setTimeRange({start:event.target.value,end:time.end})} className="instrument-input"/></label>
        <label className="grid gap-1">TO<input type="date" value={time.end} min={time.start} max={new Date().toISOString().slice(0,10)} onChange={event => useApp.getState().setTimeRange({start:time.start,end:event.target.value})} className="instrument-input"/></label>
        <button type="button" onClick={() => void useApp.getState().refreshNISARData()} disabled={nisarStatus==="loading"} className="mt-4 rounded-md border border-primary/40 px-3 py-2 text-primary disabled:opacity-50">{nisarStatus==="loading"?"SEARCHING NASA CMR":"REFRESH NISAR ARCHIVE"}</button>
      </div>
      {nisarError&&<p role="status" className="mt-3 text-xs text-amber">{nisarError}</p>}
      {realGranules.length ? <div className="mt-4 space-y-2">
        {realGranules.map(granule=><article key={granule.conceptId} className="flex flex-wrap items-start gap-3 rounded-md border border-border bg-background/30 p-3">
          {granule.browseUrl&&<a href={granule.browseUrl} target="_blank" rel="noopener noreferrer" className="block h-20 w-24 shrink-0 overflow-hidden rounded border border-border bg-background"><img src={granule.browseUrl} alt={`NISAR ${granule.productCode} browse preview`} loading="lazy" className="h-full w-full object-contain" onError={event=>{event.currentTarget.style.display="none";}}/></a>}
          <div className="min-w-0 flex-1"><div className="font-mono text-[10px] text-primary">{granule.productCode} · {(granule.startDate||"").slice(0,10)} · {granule.maturity.toUpperCase()}</div><div className="mt-1 break-all text-xs">{granule.granuleId}</div><div className="mt-2 flex flex-wrap gap-3 text-[11px]"><Link to="/observations/$id" params={{id:granule.id}} className="text-primary hover:underline">Inspect acquisition</Link><a href={granule.earthdataSearchUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Earthdata ↗</a></div></div>
        </article>)}
      </div> : <p className="mt-4 rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">{nisarStatus==="loading"?"Loading real acquisition metadata…":"No live NISAR granules matched this area and time window. Refresh or search another area in Data Explorer."}</p>}
    </section>

    <section className="scientific-band">
      <div className="label-xs text-ok">SOURCE-REPORTED PUBLIC EVENTS</div>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg">Earth event chronology</h2><p className="mt-2 text-xs leading-relaxed text-muted-foreground">USGS earthquake reports and NASA EONET natural-event records. These complement the map but are not NISAR radar measurements.</p></div><span className="font-mono text-[10px] text-muted-foreground">{liveStatus.toUpperCase()} · {publicEvents.length} SHOWN</span></div>
      {publicEvents.length ? <div className="mt-4 space-y-2">{publicEvents.map(event=><button key={event.id} type="button" onClick={()=>open(event.id)} className="flex w-full flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-background/30 p-3 text-left hover:bg-elevated"><div className="min-w-0"><div className="font-mono text-[10px] text-ok">{event.source} · {event.date.slice(0,10)}</div><div className="mt-1 text-sm">{event.title}</div><div className="mt-1 text-xs text-muted-foreground">{event.region}</div></div><span className="text-[11px] text-primary">Inspect ↗</span></button>)}</div> : <p className="mt-4 text-xs text-muted-foreground">No source-reported public events are loaded in this time range. Open Data Explorer or refresh the public feeds.</p>}
    </section>

  </div>;
}

export const AnalyzeBody = AnalyzeFlow;

const PRODUCTS = NISAR_PRODUCTS;
export function DataBody() {
  const status = useApp((s) => s.liveDataStatus);
  const liveEvents = useApp((s) => s.liveEvents);
  const updatedAt = useApp((s) => s.liveDataUpdatedAt);
  const error = useApp((s) => s.liveDataError);
  const providerStatus = useApp((s) => s.liveProviderStatus);
  const refresh = useApp((s) => s.refreshLiveData);
  return (
    <div className="space-y-5">
      <NISARCatalog />
      <PlanetaryComputerCatalog />
      <OPERACatalog />
      <section className="scientific-band">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="label-xs text-ok">PUBLIC DATA CONNECTIONS</div>
            <h2 className="mt-2 text-lg">Live event feeds</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Fetch source-reported M5+ earthquakes from the USGS two-year catalog and open/closed environmental events from NASA EONET.
              These provide historical public context only. They are not radar measurements, hazard predictions, or NISAR products.
            </p>
          </div>
          <button onClick={() => void refresh()} disabled={status === "loading"} className="inline-flex h-9 items-center gap-2 rounded-md border border-primary/40 px-3 text-xs text-primary transition-colors hover:bg-primary/10 disabled:cursor-wait disabled:opacity-60">
            <RefreshCw className={cn("size-3.5", status === "loading" && "animate-spin")} />
            {status === "loading" ? "FETCHING FEEDS" : "REFRESH PUBLIC FEEDS"}
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-border bg-background/40 p-3">
            <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">USGS Earthquake Catalog</span><span className="font-mono text-[9px] text-ok">PUBLIC · M5+ / 2 YEARS</span></div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Real source catalog entries including earthquake locations, magnitudes, depths, timestamps, and source records; this query is limited to M5+ events over the previous two years.</p>
            <a className="mt-2 inline-block text-[11px] text-primary hover:underline" href="https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php" target="_blank" rel="noopener noreferrer">Feed documentation ↗</a>
          </div>
          <div className="rounded-md border border-border bg-background/40 p-3">
            <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">NASA EONET</span><span className="font-mono text-[9px] text-ok">PUBLIC · 2-YEAR ARCHIVE</span></div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Open and closed wildfire, flood, landslide, and volcano records where EONET provides usable dated geometry.</p>
            <a className="mt-2 inline-block text-[11px] text-primary hover:underline" href="https://eonet.gsfc.nasa.gov/docs/v3" target="_blank" rel="noopener noreferrer">API documentation ↗</a>
          </div>
        </div>
        <div className="mt-4 border-t border-border pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="label-xs">STATUS · {status.replace("-", " ").toUpperCase()}</span>
            <span className="font-mono text-muted-foreground">{liveEvents.length} live records · USGS {providerStatus.usgs.status.toUpperCase()} · EONET {providerStatus.eonet.status.toUpperCase()}</span>
          </div>
          {updatedAt && <p className="mt-1 text-[11px] text-muted-foreground">Last successful refresh: {updatedAt.replace("T", " ").slice(0, 19)} UTC</p>}
          {error && <p role="status" className="mt-2 text-xs text-amber">{error}</p>}
        </div>
      </section>
      <div className="label-xs mt-8">COMMON NISAR PRODUCT FAMILIES · REFERENCE ONLY</div>
      <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">These are familiar product families, not a substitute for the live CMR results above. Availability, collection versions, access conditions, and coverage depend on the exact catalog record.</p>
      <div className="grid gap-3 md:grid-cols-3">
        {PRODUCTS.map((product) => (
          <Panel key={product.code} className="p-5">
            <div className="flex justify-between"><span className="font-mono text-[14px] text-primary">NISAR-{product.code}</span><span className="font-mono text-[10px] text-subtle">{product.level}</span></div>
            <div className="mt-2 text-[13px] text-muted-foreground">{product.name}</div>
            <div className="mt-4 font-mono text-[10px] tracking-wider text-subtle">PRODUCT FAMILY · CHECK LIVE CMR RECORD ABOVE</div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

export const LearnBody = ScienceLearn;

type DisplaySettings = {
  units: "Metric" | "Imperial";
  coords: "Decimal degrees" | "DMS";
};

const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  units: "Metric",
  coords: "Decimal degrees",
};

function formatDMS(value: number, positive: string, negative: string) {
  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minuteValue = (absolute - degrees) * 60;
  const minutes = Math.floor(minuteValue);
  const seconds = ((minuteValue - minutes) * 60).toFixed(1);
  return `${degrees}° ${minutes}' ${seconds}" ${value >= 0 ? positive : negative}`;
}

export function SettingsBody() {
  const [settings, setSettings] = useState<DisplaySettings>(DEFAULT_DISPLAY_SETTINGS);
  const [voicePreferences, setVoicePreferences] = useState<VoicePreferences>(DEFAULT_VOICE_PREFERENCES);
  const [voicePreferencesLoaded, setVoicePreferencesLoaded] = useState(false);
  const [voiceStorageError, setVoiceStorageError] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("te-display-settings");
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<DisplaySettings>;
        setSettings({
          units: parsed.units === "Imperial" ? "Imperial" : "Metric",
          coords: parsed.coords === "DMS" ? "DMS" : "Decimal degrees",
        });
      }
    } catch {
      // Invalid or blocked local storage should never stop the settings screen.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("te-display-settings", JSON.stringify(settings));
    } catch {
      // The controls remain usable in private browsing when storage is unavailable.
    }
  }, [settings]);

  useEffect(() => {
    setVoicePreferences(readVoicePreferences());
    setVoicePreferencesLoaded(true);
  }, []);

  useEffect(() => {
    if (!voicePreferencesLoaded) return;
    const saved = writeVoicePreferences(voicePreferences);
    setVoiceStorageError(!saved);
    if (saved) window.dispatchEvent(new Event(VOICE_SETTINGS_EVENT));
  }, [voicePreferences, voicePreferencesLoaded]);

  const setOption = (key: "units" | "coords", value: string) => {
    setSettings((current) => key === "units"
      ? { ...current, units: value as DisplaySettings["units"] }
      : { ...current, coords: value as DisplaySettings["coords"] });
  };
  const example = settings.coords === "DMS"
    ? `${formatDMS(19.076, "N", "S")}  ${formatDMS(72.8777, "E", "W")}`
    : formatCoord(19.076, 72.8777);

  const preferences = [
    { label: "Units", key: "units" as const, options: ["Metric", "Imperial"] as const },
    { label: "Coordinates", key: "coords" as const, options: ["Decimal degrees", "DMS"] as const },
  ];
  const setVoiceOption = <K extends keyof VoicePreferences>(key: K, value: VoicePreferences[K]) => {
    setVoicePreferences(current => ({ ...current, [key]: value }));
  };

  return (
    <div className="space-y-4">
    <Panel className="divide-y divide-border">
      {preferences.map(({ label, key, options }) => (
        <div key={key} className="flex flex-wrap items-center justify-between gap-3 p-4 text-[13px]">
          <span>{label}</span>
          <div className="flex gap-1">
            {options.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={settings[key] === option}
                onClick={() => setOption(key, option)}
                className={cn(
                  "rounded-md border px-3 py-1 text-[12px] transition-colors",
                  settings[key] === option ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-elevated",
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between gap-3 p-4 text-[13px]">
        <div>
          <div>Replay intro animation</div>
          <p className="mt-1 text-[11px] text-muted-foreground">Show the Third Eye title screen again.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            sessionStorage.removeItem("te-intro");
            window.location.reload();
          }}
          className="shrink-0 rounded-md border border-border px-3 py-1.5 text-[12px] transition-colors hover:bg-elevated"
        >
          Replay
        </button>
      </div>
      <div className="space-y-1 p-4">
        <div className="label-xs">COORDINATE PREVIEW</div>
        <div className="font-mono text-[11px] text-muted-foreground">{example}</div>
        <p className="text-[10px] text-subtle">Units: {settings.units}. Preferences are saved on this device.</p>
      </div>
    </Panel>
    <Panel className="divide-y divide-border">
      <div className="p-4">
        <div className="label-xs text-primary">VOICE CONVERSATION</div>
        <h2 className="mt-1 text-sm font-medium">Talk to Third Eye</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Voice starts only when you press the microphone or use Ctrl/Cmd+Shift+Space. There is no wake word. Follow-up listening ends after the selected quiet interval.
        </p>
      </div>
      {([
        ["inputEnabled", "Voice input", "Allow microphone commands."],
        ["responsesEnabled", "Spoken responses", "Read assistant replies aloud."],
        ["conversationModeEnabled", "Conversation mode", "Listen for up to six follow-ups until the quiet timer expires."],
      ] as const).map(([key, label, description]) => (
        <div key={key} className="flex items-center justify-between gap-4 p-4">
          <div>
            <div className="text-[13px]">{label}</div>
            <p className="mt-1 text-[11px] text-muted-foreground">{description}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-label={label}
            aria-checked={voicePreferences[key]}
            onClick={() => setVoiceOption(key, !voicePreferences[key])}
            className={cn(
              "relative h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              voicePreferences[key] ? "border-primary bg-primary/30" : "border-border bg-background",
            )}
          >
            <span className={cn(
              "absolute top-0.5 size-4 rounded-full bg-foreground transition-transform",
              voicePreferences[key] ? "translate-x-5" : "translate-x-0.5",
            )} />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <div className="text-[13px]">Follow-up window</div>
          <p className="mt-1 text-[11px] text-muted-foreground">Seconds to wait for another command.</p>
        </div>
        <div className="flex gap-1">
          {[5, 15, 30, 60].map(seconds => (
            <button
              key={seconds}
              type="button"
              aria-pressed={voicePreferences.inactivityTimeoutSeconds === seconds}
              onClick={() => setVoiceOption("inactivityTimeoutSeconds", seconds)}
              className={cn(
                "rounded-md border px-3 py-1 text-[12px] transition-colors",
                voicePreferences.inactivityTimeoutSeconds === seconds ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-elevated",
              )}
            >
              {seconds}s
            </button>
          ))}
        </div>
      </div>
      <div className="p-4 text-[10px] text-subtle">
        {voiceStorageError
          ? "This browser is blocking local storage, so voice preferences will not persist after you leave this page."
          : "Voice preferences are saved on this device."}
        {" "}You can stop listening or cancel a request at any time.
      </div>
    </Panel>
    </div>
  );
}

export function AboutBody() {
  return (
    <Panel className="max-w-2xl p-6 text-[14px] leading-relaxed text-muted-foreground">
      <p>Third Eye combines a 3D globe, 2D map, historical timeline, area-of-interest tools, data discovery, and an interactive command interface.</p>
      <p className="mt-3">The app queries NASA's Common Metadata Repository (CMR) for NISAR product records, collection metadata, acquisition times, spatial footprints, and browse previews where a provider supplies them. It also loads attributed public context records from the USGS earthquake catalog and NASA EONET.</p>
      <div className="mt-4 rounded-md border border-border bg-background/40 p-4">
        <div className="label-xs text-amber">WHAT IS REAL — AND WHAT IS NOT</div>
        <p className="mt-2 text-[13px]">A CMR acquisition record and its footprint are real catalogue information. A browse image is only a preview; it is not a processed scientific raster or a hazard detection. This frontend does not yet download and process full-resolution NISAR SAR rasters, make interferograms, or verify flood, fire, landslide, or deformation detections. Those steps require a separate, authenticated data and processing pipeline.</p>
        <p className="mt-3 text-[13px]">The assistant uses Groq when server-side credentials and a model are configured; otherwise it reports that it is using limited rule-based viewer controls. Neither mode creates scientific measurements or hazard predictions. Its application actions are constrained to supported viewer operations.</p>
        <p className="mt-3 text-[13px]">Some full-resolution downloads require a NASA Earthdata Login. Provisional NISAR products may also carry validation limitations.</p>
        <div className="mt-3 flex flex-wrap gap-4 text-xs">
          <a className="text-primary hover:underline" href="https://nisar-docs.asf.alaska.edu/availability-overview/" target="_blank" rel="noopener noreferrer">NISAR data availability ↗</a>
          <a className="text-primary hover:underline" href="https://nisar-docs.asf.alaska.edu/access-overview/" target="_blank" rel="noopener noreferrer">NISAR data access ↗</a>
          <a className="text-primary hover:underline" href="https://surveyofindia.gov.in/pages/political-map-of-india" target="_blank" rel="noopener noreferrer">Survey of India political map reference ↗</a>
        </div>
      </div>
      <Link to="/dashboard" className="mt-5 inline-flex rounded-md bg-primary px-4 py-2 text-[12px] font-medium text-primary-foreground">Open Explore</Link>
    </Panel>
  );
}
