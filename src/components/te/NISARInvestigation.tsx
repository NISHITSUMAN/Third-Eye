import { useEffect, useMemo, useState } from "react";
import { Download, Play, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { useApp } from "@/lib/store";
import type { NISARGranule } from "@/lib/nasa-cmr";
import { assessNISARPair, discoverNISARPairs } from "@/lib/nisar-pairing";
import {
  cancelGuestNISARJob,
  forgetGuestNISARCapability,
  GUEST_NISAR_CAPABILITY_EVENT,
  getGuestNISARStatus,
  readGuestNISARCapability,
  submitGuestNISARComparison,
  type GuestNISARJob as GuestJob,
  type GuestNISARCapability as SavedCapability,
} from "@/lib/guest-nisar";
const PRODUCT = /^NISAR_[LS][0-3]_[A-Z]{2}_GCOV_[A-Za-z0-9_]+(?:\.h5)?$/;

function isGCOV(granule: NISARGranule) {
  return granule.productCode === "GCOV" && PRODUCT.test(granule.granuleId);
}
function formatNumber(value: unknown, digits = 3) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

export function NISARInvestigation() {
  const aoi = useApp(state => state.aoi);
  const granules = useApp(state => state.nisarGranules);
  const gcov = useMemo(() => granules.filter(isGCOV), [granules]);
  const pairSuggestions = useMemo(
    () => discoverNISARPairs(
      gcov,
      frequency as "frequencyA" | "frequencyB",
      polarization as "HHHH" | "HVHV" | "VVVV" | "VHVH" | "RHRH" | "RVRV",
      6,
    ),
    [gcov, frequency, polarization],
  );
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
  const chronologicalPair = Boolean(before?.startDate && after?.startDate && Date.parse(before.startDate) < Date.parse(after.startDate));
  const selectedPairAssessment = before && after
    ? assessNISARPair(
        before,
        after,
        frequency as "frequencyA" | "frequencyB",
        polarization as "HHHH" | "HVHV" | "VVVV" | "VHVH" | "RHRH" | "RVRV",
      )
    : null;
  const canSubmit = Boolean(
    aoi?.feature.geometry &&
    (aoi.feature.geometry.type === "Polygon" || aoi.feature.geometry.type === "MultiPolygon") &&
    before && after && before.conceptId !== after.conceptId && chronologicalPair &&
    selectedPairAssessment?.compatible && !submitting && (!job || !["queued", "processing"].includes(job.status))
  );

  const refresh = async (saved = capability) => {
    if (!saved) return;
    setJob(await getGuestNISARStatus(saved));
  };

  useEffect(() => {
    const saved = readGuestNISARCapability();
    if (saved) {
      setCapability(saved);
      void refresh(saved).catch(reason => {
        forgetGuestNISARCapability();
        setCapability(null);
        setError(reason instanceof Error ? reason.message : "Saved guest access has expired.");
      });
    }
    const onCapability = () => {
      const detail = readGuestNISARCapability();
      setCapability(detail);
      if (detail) void refresh(detail).catch(reason => setError(reason instanceof Error ? reason.message : "Guest status refresh failed."));
      else setJob(null);
    };
    window.addEventListener(GUEST_NISAR_CAPABILITY_EVENT, onCapability);
    return () => window.removeEventListener(GUEST_NISAR_CAPABILITY_EVENT, onCapability);
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
      const submitted = await submitGuestNISARComparison({
        before,
        after,
        aoi: aoi.feature.geometry,
        frequency: frequency as "frequencyA" | "frequencyB",
        polarizationTerm: polarization as "HHHH" | "HVHV" | "VVVV" | "VHVH" | "RHRH" | "RVRV",
      });
      setCapability(submitted.capability);
      setJob(submitted.job);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The NISAR investigation could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (!capability) return;
    try {
      setJob(await cancelGuestNISARJob(capability));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Cancellation failed.");
    }
  };

  const forget = () => {
    forgetGuestNISARCapability();
    setCapability(null);
    setJob(null);
    setError(null);
  };
  const downloadSummaryCSV = () => {
    if (!job || !summary) return;
    const rows = Object.entries(summary).filter((entry): entry is [string, number] =>
      typeof entry[1] === "number" && Number.isFinite(entry[1]),
    );
    const csv = ["metric,value", ...rows.map(([key, value]) => key + "," + value)].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "third-eye-" + job.id + "-summary.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const downloadProvenanceJSON = () => {
    if (!job) return;
    const bundle = {
      report_type: "NISAR GCOV backscatter change measurement",
      generated_at: new Date().toISOString(),
      job_id: job.id,
      status: job.status,
      result: job.result,
      provenance: job.provenance,
      validation: { performed: false, reason: "No independent reference raster was supplied to this processing job." },
      interpretation_limits: [
        "Backscatter change is not a water or flood classification.",
        "Harmony retrieves the bounding rectangle, then the worker clips the derived raster to pixel centres inside the submitted polygon. Boundary pixels are not area-fraction weighted.",
        "The selected acquisitions must be independently reviewed for scientific suitability.",
      ],
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "third-eye-" + job.id + "-provenance.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const downloadScientificPDF = async () => {
    if (!job || !summary) return;
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF();
      const lines = [
        "THIRD EYE — NISAR GCOV CHANGE REPORT",
        "Job: " + job.id,
        "Generated: " + new Date().toISOString(),
        "Measurement: " + String(job.result?.measurement ?? "After-minus-before gamma0 backscatter change"),
        "Status: " + job.status,
        "",
        "SUMMARY",
        ...Object.entries(summary).map(([key, value]) => key + ": " + String(value)),
        "",
        "SCIENTIFIC LIMITATIONS",
        "This report describes measured gamma0 backscatter change only. It does not provide a water mask, flood extent, or hazard classification.",
        "Harmony retrieves the bounding rectangle, then the worker clips the derived raster to pixel centres inside the submitted polygon. Boundary pixels are not area-fraction weighted.",
        "Independent validation against OPERA DSWx, JRC Global Surface Water, or another reference raster was not performed.",
        "No calibrated probability or confidence score is generated by this workflow.",
        "",
        "PROVENANCE",
        JSON.stringify(job.provenance ?? {}, null, 2),
      ];
      let y = 18;
      for (const line of lines) {
        const wrapped = doc.splitTextToSize(line, 178) as string[];
        for (const part of wrapped) {
          if (y > 278) { doc.addPage(); y = 18; }
          doc.setFontSize(line === "THIRD EYE — NISAR GCOV CHANGE REPORT" ? 15 : 9);
          doc.text(part, 16, y);
          y += 5;
        }
      }
      doc.save("third-eye-" + job.id + "-scientific-report.pdf");
    } catch {
      setError("The scientific PDF could not be generated. The JSON provenance and CSV summary exports remain available.");
    }
  };


  const summary = job?.result?.summary && typeof job.result.summary === "object"
    ? job.result.summary as Record<string, unknown>
    : null;
  const rasterUrl = typeof job?.result?.raster_url === "string" ? job.result.raster_url : null;
  const previewUrl = typeof job?.result?.preview_url === "string" ? job.result.preview_url : null;

  return <section className="scientific-band mt-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="label-xs text-primary">NISAR GCOV · PUBLIC INVESTIGATION</div>
        <h2 className="mt-2 text-lg">Compare two radar acquisitions</h2>
        <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">Submit a bounded before/after GCOV backscatter comparison without creating an account. Access is protected by a private browser-held capability that expires after 24 hours. NASA Harmony retrieves the AOI bounding rectangle; the worker then clips the derived raster to pixel centres inside the submitted polygon, preserving holes. This measurement is not a flood classification.</p>
      </div>
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><ShieldCheck className="size-3"/>PRIVATE GUEST ACCESS</span>
    </div>

    {!aoi && <p className="mt-4 rounded border border-amber/30 bg-amber/5 p-3 text-xs text-amber">Select or draw a polygon AOI in the map before processing.</p>}
    {gcov.length < 2 && <p className="mt-4 rounded border border-border bg-background/30 p-3 text-xs text-muted-foreground">Load at least two real GCOV granule records in the NISAR catalog for the selected area and date range. Only catalog records with GCOV product identifiers are eligible.</p>}

    <div className="mt-4 rounded-lg border border-border bg-background/35 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="label-xs text-primary">AUTOMATIC PAIR DISCOVERY</div>
          <p className="mt-1 text-xs text-muted-foreground">Pairs are screened by orbit, frame, polarization mode, bandwidth, processing release, coverage and 1–365 day separation. The worker repeats these checks before downloading data.</p>
        </div>
        <span className="text-[10px] text-muted-foreground">{pairSuggestions.length} compatible pair{pairSuggestions.length === 1 ? "" : "s"}</span>
      </div>
      {pairSuggestions.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {pairSuggestions.map(pair => <button
          key={pair.before.conceptId + ":" + pair.after.conceptId}
          type="button"
          onClick={() => { setBeforeId(pair.before.conceptId); setAfterId(pair.after.conceptId); }}
          className={"rounded-md border px-3 py-2 text-left text-xs transition-colors " + (beforeId === pair.before.conceptId && afterId === pair.after.conceptId ? "border-primary bg-primary/10" : "border-border hover:border-primary/50")}
        >
          <span className="block font-medium">{pair.before.startDate?.slice(0, 10)} → {pair.after.startDate?.slice(0, 10)}</span>
          <span className="mt-1 block text-[10px] text-muted-foreground">Track {pair.before.trackNumber ?? "—"} · Frame {pair.before.frameNumber ?? "—"} · {pair.assessment.temporalGapDays.toFixed(1)} days apart</span>
        </button>)}
      </div> : <p className="mt-3 text-[11px] text-muted-foreground">No compatible full-coverage pair was found in the currently loaded records for this frequency and covariance term. Try another frequency/term or broaden the catalog date range.</p>}
    </div>

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
    {before && after && <p className={"mt-3 text-[11px] " + (selectedPairAssessment?.compatible ? "text-muted-foreground" : "text-amber")}>Pair: {before.startDate ?? "unknown"} → {after.startDate ?? "unknown"} · {selectedPairAssessment?.compatible ? "Metadata screening passed; the worker still verifies actual raster availability and grid alignment." : selectedPairAssessment?.reasons.join(" · ") ?? "Choose two acquisitions."}</p>}

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
      {previewUrl && <figure className="mt-4 overflow-hidden rounded-lg border border-border bg-background">
        <img src={previewUrl} alt="Display-only preview of derived NISAR gamma0 backscatter difference. Blue indicates negative change, red indicates positive change, and transparent pixels fall outside valid AOI coverage." className="block max-h-[420px] w-full object-contain" />
        <figcaption className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
          <span>DERIVED CHANGE QUICKLOOK · NOT A GEOGRAPHICALLY ALIGNED MAP</span>
          <span>Blue: negative · Neutral: near zero · Red: positive</span>
        </figcaption>
      </figure>}
      {summary && <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div><div className="label-xs text-subtle">MEAN CHANGE</div><div className="mt-1 font-mono text-lg">{formatNumber(summary.mean_delta_db)} dB</div></div>
        <div><div className="label-xs text-subtle">VALID PIXELS</div><div className="mt-1 font-mono text-lg">{typeof summary.valid_pixels === "number" ? summary.valid_pixels.toLocaleString() : "—"}</div></div>
        <div><div className="label-xs text-subtle">VALID AREA</div><div className="mt-1 font-mono text-lg">{formatNumber(summary.valid_area_km2,2)} km²</div></div>
      </div>}
      {rasterUrl && <a href={rasterUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-2 text-xs text-primary hover:underline"><Download className="size-3.5"/>Download derived GeoTIFF</a>}
      {job.status === "completed" && summary && <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => void downloadScientificPDF()} className="inline-flex h-9 items-center gap-2 rounded border border-border px-3 text-xs"><Download className="size-3.5"/>Scientific PDF</button>
        <button type="button" onClick={downloadSummaryCSV} className="inline-flex h-9 items-center gap-2 rounded border border-border px-3 text-xs">Summary CSV</button>
        <button type="button" onClick={downloadProvenanceJSON} className="inline-flex h-9 items-center gap-2 rounded border border-border px-3 text-xs">Provenance JSON</button>
      </div>}
      {job.status === "completed" && <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">This is a measured change in gamma0 backscatter. It is not a water mask, flood extent, or validated hazard finding. The preview is not georeferenced; use the GeoTIFF in a GIS for spatial overlay. Coverage and percentile diagnostics describe data quality, not calibrated uncertainty.</p>}
      <p className="mt-3 text-[10px] text-subtle">Guest access expires {new Date(job.expiresAt).toLocaleString()} · The access token is held only in this browser session.</p>
    </div>}
  </section>;
}
