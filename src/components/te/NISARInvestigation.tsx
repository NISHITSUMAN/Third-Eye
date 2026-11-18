import { useEffect, useMemo, useState } from "react";
import { Download, Play, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { useApp } from "@/lib/store";
import type { NISARGranule } from "@/lib/nasa-cmr";

type GuestJob = {
  id: string;
  workflowId: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  stage: string;
  progress: number;
  errorMessage: string | null;
  result: Record<string, unknown> | null;
  provenance: Record<string, unknown> | null;
  expiresAt: string;
};
type SavedCapability = { jobId: string; token: string };

const TOKEN_KEY = "third-eye:guest-nisar-capability:v1";
const PRODUCT = /^NISAR_[LS][0-3]_[A-Z]{2}_GCOV_[A-Za-z0-9_]+(?:\.h5)?$/;

function isGCOV(granule: NISARGranule) {
  return granule.productCode === "GCOV" && PRODUCT.test(granule.granuleId);
}
function readCapability(): SavedCapability | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SavedCapability>;
    return typeof value.jobId === "string" && typeof value.token === "string"
      ? { jobId: value.jobId, token: value.token }
      : null;
  } catch {
    return null;
  }
}
function formatNumber(value: unknown, digits = 3) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

export function NISARInvestigation() {
  const aoi = useApp(state => state.aoi);
  const granules = useApp(state => state.nisarGranules);
  const gcov = useMemo(() => granules.filter(isGCOV), [granules]);
  const [beforeId, setBeforeId] = useState("");
  const [afterId, setAfterId] = useState("");
  const [frequency, setFrequency] = useState("frequencyA");
  const [polarization, setPolarization] = useState("HHHH");
  const [capability, setCapability] = useState<SavedCapability | null>(null);
  const [job, setJob] = useState<GuestJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const before = gcov.find(item => item.conceptId === beforeId) ?? null;
  const after = gcov.find(item => item.conceptId === afterId) ?? null;
  const canSubmit = Boolean(
    aoi?.feature.geometry &&
    (aoi.feature.geometry.type === "Polygon" || aoi.feature.geometry.type === "MultiPolygon") &&
    before && after && before.conceptId !== after.conceptId &&
    !submitting && (!job || !["queued", "processing"].includes(job.status))
  );

  const refresh = async (saved = capability) => {
    if (!saved) return;
    const response = await fetch("/api/science/jobs/" + encodeURIComponent(saved.jobId), {
      headers: { Authorization: "Bearer " + saved.token, Accept: "application/json" },
      cache: "no-store",
    });
    const payload = await response.json() as { job?: GuestJob; error?: string };
    if (!response.ok || !payload.job) throw new Error(payload.error || "Guest investigation status could not be loaded.");
    setJob(payload.job);
  };

  useEffect(() => {
    const saved = readCapability();
    if (!saved) return;
    setCapability(saved);
    void refresh(saved).catch(reason => {
      sessionStorage.removeItem(TOKEN_KEY);
      setCapability(null);
      setError(reason instanceof Error ? reason.message : "Saved guest access has expired.");
    });
  }, []);

  useEffect(() => {
    if (!capability || !job || !["queued", "processing"].includes(job.status)) return;
    const timer = window.setInterval(() => {
      void refresh().catch(reason => setError(reason instanceof Error ? reason.message : "Status refresh failed."));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [capability, job?.status]);

  const submit = async () => {
    if (!before || !after || !aoi?.feature.geometry || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    setJob(null);
    try {
      const response = await fetch("/api/science/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          beforeProductId: before.granuleId.replace(/\.h5$/i, ""),
          beforeCollectionConceptId: before.collectionConceptId,
          beforeGranuleConceptId: before.conceptId,
          afterProductId: after.granuleId.replace(/\.h5$/i, ""),
          afterCollectionConceptId: after.collectionConceptId,
          afterGranuleConceptId: after.conceptId,
          aoi: aoi.feature.geometry,
          frequency,
          polarizationTerm: polarization,
        }),
      });
      const payload = await response.json() as { jobId?: string; accessToken?: string; error?: string };
      if (!response.ok || !payload.jobId || !payload.accessToken) throw new Error(payload.error || "The NISAR investigation could not be queued.");
      const saved = { jobId: payload.jobId, token: payload.accessToken };
      sessionStorage.setItem(TOKEN_KEY, JSON.stringify(saved));
      setCapability(saved);
      await refresh(saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The NISAR investigation could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (!capability) return;
    try {
      const response = await fetch("/api/science/jobs/" + encodeURIComponent(capability.jobId), {
        method: "DELETE",
        headers: { Authorization: "Bearer " + capability.token, Accept: "application/json" },
      });
      const payload = await response.json() as { job?: GuestJob; error?: string };
      if (!response.ok || !payload.job) throw new Error(payload.error || "Cancellation failed.");
      setJob(payload.job);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Cancellation failed.");
    }
  };

  const forget = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    setCapability(null);
    setJob(null);
    setError(null);
  };

  const summary = job?.result?.summary && typeof job.result.summary === "object"
    ? job.result.summary as Record<string, unknown>
    : null;
  const rasterUrl = typeof job?.result?.raster_url === "string" ? job.result.raster_url : null;

  return <section className="scientific-band mt-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="label-xs text-primary">NISAR GCOV · PUBLIC INVESTIGATION</div>
        <h2 className="mt-2 text-lg">Compare two radar acquisitions</h2>
        <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">Submit a bounded before/after GCOV backscatter comparison without creating an account. Access is protected by a private browser-held capability that expires after 24 hours. The server subsets the acquisition bounding rectangle; polygon-edge pixel clipping is not yet applied. This measurement is not a flood classification.</p>
      </div>
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><ShieldCheck className="size-3"/>PRIVATE GUEST ACCESS</span>
    </div>

    {!aoi && <p className="mt-4 rounded border border-amber/30 bg-amber/5 p-3 text-xs text-amber">Select or draw a polygon AOI in the map before processing.</p>}
    {gcov.length < 2 && <p className="mt-4 rounded border border-border bg-background/30 p-3 text-xs text-muted-foreground">Load at least two real GCOV granule records in the NISAR catalog for the selected area and date range. Only catalog records with GCOV product identifiers are eligible.</p>}

    <div className="mt-4 grid gap-3 md:grid-cols-2">
      <label className="text-xs text-muted-foreground">BEFORE ACQUISITION
        <select value={beforeId} onChange={event => setBeforeId(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3 text-xs text-foreground">
          <option value="">Select earlier GCOV record</option>
          {gcov.map(item => <option key={item.conceptId} value={item.conceptId}>{item.startDate?.slice(0,10) ?? "Date unavailable"} · {item.granuleId}</option>)}
        </select>
      </label>
      <label className="text-xs text-muted-foreground">AFTER ACQUISITION
        <select value={afterId} onChange={event => setAfterId(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3 text-xs text-foreground">
          <option value="">Select later GCOV record</option>
          {gcov.map(item => <option key={item.conceptId} value={item.conceptId}>{item.startDate?.slice(0,10) ?? "Date unavailable"} · {item.granuleId}</option>)}
        </select>
      </label>
      <label className="text-xs text-muted-foreground">FREQUENCY
        <select value={frequency} onChange={event => setFrequency(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3 text-xs text-foreground">
          <option value="frequencyA">Frequency A</option><option value="frequencyB">Frequency B</option>
        </select>
      </label>
      <label className="text-xs text-muted-foreground">COVARIANCE TERM
        <select value={polarization} onChange={event => setPolarization(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3 text-xs text-foreground">
          {["HHHH","HVHV","VVVV","VHVH","RHRH","RVRV"].map(value => <option key={value}>{value}</option>)}
        </select>
      </label>
    </div>
    {before && after && <p className="mt-3 text-[11px] text-muted-foreground">Pair: {before.startDate ?? "unknown"} → {after.startDate ?? "unknown"} · Compatibility is checked again by the scientific worker before any comparison.</p>}

    <div className="mt-4 flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => void submit()} disabled={!canSubmit} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
        {submitting ? <RefreshCw className="size-3.5 animate-spin"/> : <Play className="size-3.5"/>}
        {submitting ? "SUBMITTING…" : "RUN NISAR COMPARISON"}
      </button>
      {job && ["queued","processing"].includes(job.status) && <button type="button" onClick={() => void cancel()} className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-3 text-xs"><XCircle className="size-3.5"/>CANCEL</button>}
      {capability && <button type="button" onClick={() => void refresh().catch(reason => setError(reason instanceof Error ? reason.message : "Refresh failed."))} className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-3 text-xs"><RefreshCw className="size-3.5"/>REFRESH</button>}
      {capability && <button type="button" onClick={forget} className="h-10 px-2 text-xs text-muted-foreground hover:text-foreground">Forget this guest job</button>}
    </div>

    {error && <p role="alert" className="mt-3 rounded border border-amber/30 bg-amber/5 p-3 text-xs text-amber">{error}</p>}
    {job && <div className="mt-4 rounded-lg border border-border bg-background/35 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><div className="label-xs text-primary">INVESTIGATION {job.id.slice(0,8).toUpperCase()}</div><div className="mt-1 text-sm font-medium">{job.status.toUpperCase()} · {job.stage}</div></div>
        <div className="font-mono text-xs">{job.progress}%</div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{width: job.progress + "%"}}/></div>
      {job.errorMessage && <p className="mt-3 text-xs text-amber">{job.errorMessage}</p>}
      {summary && <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div><div className="label-xs text-subtle">MEAN CHANGE</div><div className="mt-1 font-mono text-lg">{formatNumber(summary.mean_change_db)} dB</div></div>
        <div><div className="label-xs text-subtle">VALID PIXELS</div><div className="mt-1 font-mono text-lg">{typeof summary.valid_pixels === "number" ? summary.valid_pixels.toLocaleString() : "—"}</div></div>
        <div><div className="label-xs text-subtle">VALID AREA</div><div className="mt-1 font-mono text-lg">{formatNumber(summary.valid_area_km2,2)} km²</div></div>
      </div>}
      {rasterUrl && <a href={rasterUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-2 text-xs text-primary hover:underline"><Download className="size-3.5"/>Download derived GeoTIFF</a>}
      {job.status === "completed" && <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">This is a measured change in gamma0 backscatter. It is not a water mask, flood extent, or validated hazard finding. Inspect the acquisition provenance and limitations before interpreting it.</p>}
      <p className="mt-3 text-[10px] text-subtle">Guest access expires {new Date(job.expiresAt).toLocaleString()} · The access token is held only in this browser session.</p>
    </div>}
  </section>;
}
