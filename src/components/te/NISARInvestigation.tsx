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
  const [beforeId, setBeforeId] = useState("");
  const [afterId, setAfterId] = useState("");
  const [frequency, setFrequency] = useState("frequencyA");
  const [polarization, setPolarization] = useState("HHHH");
  const [capability, setCapability] = useState<SavedCapability | null>(null);
  const [job, setJob] = useState<GuestJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pairSuggestions = useMemo(
    () => discoverNISARPairs(
      gcov,
      frequency as "frequencyA" | "frequencyB",
      polarization as "HHHH" | "HVHV" | "VVVV" | "VHVH" | "RHRH" | "RVRV",
      6,
    ),
    [gcov, frequency, polarization],
  );

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
    const currentJob = await getGuestNISARStatus(saved);
    setJob(currentJob);
    const previewUrl = typeof currentJob.result?.preview_url === "string" ? currentJob.result.preview_url : null;
    const rawBounds = currentJob.result?.preview_bounds_wgs84;
    const bounds = Array.isArray(rawBounds) && rawBounds.length === 4 && rawBounds.every(value => typeof value === "number" && Number.isFinite(value))
      ? rawBounds as [number, number, number, number]
      : null;
    if (currentJob.status === "completed" && previewUrl && bounds) {
      useApp.getState().setGuestNISARMapResult({
        jobId: currentJob.id,
        previewUrl,
        boundsWgs84: bounds,
      });
    } else if (currentJob.status !== "completed") {
      useApp.getState().setGuestNISARMapResult(null);
    }
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
      else {
        setJob(null);
        useApp.getState().setGuestNISARMapResult(null);
      }
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
    useApp.getState().setGuestNISARMapResult(null);
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
    const safeResult = job.result ? { ...job.result } : null;
    if (safeResult) {
      delete safeResult.raster_url;
      delete safeResult.preview_url;
      delete safeResult.screening_mask_url;
      delete safeResult.uncertainty_url;
      delete safeResult.water_screening_mask_url;
    }
    const bundle = {
      report_type: "NISAR GCOV backscatter change measurement",
      generated_at: new Date().toISOString(),
      job_id: job.id,
      status: job.status,
      result: safeResult,
      provenance: job.provenance,
      validation: job.result?.independent_reference_agreement ?? { performed: false, reason: "No independent reference comparison was run." },
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
        "Any OPERA comparison, when present, measures exploratory agreement of the fixed-threshold screening proxy; it is not flood-classifier validation.",
        "No calibrated probability or confidence score is generated by this workflow. When both scenes contain aligned numberOfLooks data, an approximate first-order measurement-noise diagnostic may be available; it is not a formal scene-level uncertainty estimate.",
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
  const screeningMaskUrl = typeof job?.result?.screening_mask_url === "string" ? job.result.screening_mask_url : null;
  const uncertaintyUrl = typeof job?.result?.uncertainty_url === "string" ? job.result.uncertainty_url : null;
  const waterScreeningMaskUrl = typeof job?.result?.water_screening_mask_url === "string" ? job.result.water_screening_mask_url : null;
  const waterScreening = job?.provenance?.water_screening && typeof job.provenance.water_screening === "object"
    ? job.provenance.water_screening as Record<string, unknown>
    : null;
  const measurementUncertainty = job?.provenance?.measurement_uncertainty && typeof job.provenance.measurement_uncertainty === "object"
    ? job.provenance.measurement_uncertainty as Record<string, unknown>
    : null;
  const sensitivity = Array.isArray(job?.result?.negative_change_threshold_sensitivity)
    ? job.result.negative_change_threshold_sensitivity as Array<Record<string, unknown>>
    : [];
  const qualityDiagnostics = job?.result?.quality_diagnostics && typeof job.result.quality_diagnostics === "object"
    ? job.result.quality_diagnostics as Record<string, unknown>
    : null;
  const referenceAgreement = job?.result?.independent_reference_agreement && typeof job.result.independent_reference_agreement === "object"
    ? job.result.independent_reference_agreement as Record<string, unknown>
    : null;
  const referenceReport = referenceAgreement?.report && typeof referenceAgreement.report === "object"
    ? referenceAgreement.report as Record<string, unknown>
    : null;
  const referenceMetrics = referenceReport?.metrics && typeof referenceReport.metrics === "object"
    ? referenceReport.metrics as Record<string, unknown>
    : null;
  const referenceMetadata = referenceAgreement?.reference && typeof referenceAgreement.reference === "object"
    ? referenceAgreement.reference as Record<string, unknown>
    : null;

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
          <span>DERIVED CHANGE QUICKLOOK · APPROXIMATE RASTER-BOUNDS OVERLAY</span>
          <span>Blue: negative · Neutral: near zero · Red: positive</span>
        </figcaption>
      </figure>}
      {job.status === "completed" && referenceAgreement && <div className="mt-4 rounded-md border border-border bg-background/50 p-3">
        <div className="label-xs text-primary">INDEPENDENT REFERENCE CHECK · EXPLORATORY ONLY</div>
        {referenceAgreement.performed === true ? <>
          <p className="mt-2 text-xs font-medium">{String(referenceMetadata?.product ?? "OPERA DSWx-S1")}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">Granule {String(referenceMetadata?.granule_ur ?? referenceMetadata?.granule_concept_id ?? "—")} · acquired {String(referenceMetadata?.acquired_at ?? "—")}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            <div><div className="text-[10px] text-muted-foreground">PRECISION</div><div className="font-mono text-sm">{formatNumber(referenceMetrics?.precision, 3)}</div></div>
            <div><div className="text-[10px] text-muted-foreground">RECALL</div><div className="font-mono text-sm">{formatNumber(referenceMetrics?.recall, 3)}</div></div>
            <div><div className="text-[10px] text-muted-foreground">F1</div><div className="font-mono text-sm">{formatNumber(referenceMetrics?.f1, 3)}</div></div>
            <div><div className="text-[10px] text-muted-foreground">IOU</div><div className="font-mono text-sm">{formatNumber(referenceMetrics?.intersection_over_union, 3)}</div></div>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">Compared {String(referenceReport?.evaluated_pixels ?? "—")} common valid pixels. These scores describe agreement of the fixed-threshold negative-backscatter screening proxy with OPERA classes for this AOI/date pair only. They are not flood-classifier accuracy, calibrated confidence, or transferable performance.</p>
        </> : <p className="mt-2 text-xs text-muted-foreground">{String(referenceAgreement.reason ?? "No time-matched independent reference was available.")}</p>}
      </div>}
      {job.status === "completed" && measurementUncertainty && <div className="mt-4 rounded-md border border-border bg-background/50 p-3">
        <div className="label-xs text-primary">MEASUREMENT-NOISE DIAGNOSTIC</div>
        {measurementUncertainty.available === true ? <>
          <p className="mt-2 text-xs">Median approximate standard error: <strong>{formatNumber(measurementUncertainty.median_standard_error_db)} dB</strong></p>
          <p className="mt-1 text-xs">Median approximate 95% half-width: <strong>±{formatNumber(measurementUncertainty.median_approximate_95_percent_half_width_db)} dB</strong></p>
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{String(measurementUncertainty.warning ?? "Approximate diagnostic only.")}</p>
        </> : <p className="mt-2 text-xs text-muted-foreground">{String(measurementUncertainty.interpretation ?? "Unavailable for this acquisition pair.")}</p>}
      </div>}
      {summary && <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div><div className="label-xs text-subtle">MEAN CHANGE</div><div className="mt-1 font-mono text-lg">{formatNumber(summary.mean_delta_db)} dB</div></div>
        <div><div className="label-xs text-subtle">VALID PIXELS</div><div className="mt-1 font-mono text-lg">{typeof summary.valid_pixels === "number" ? summary.valid_pixels.toLocaleString() : "—"}</div></div>
        <div><div className="label-xs text-subtle">VALID AREA</div><div className="mt-1 font-mono text-lg">{formatNumber(summary.valid_area_km2,2)} km²</div></div>
      </div>}
      <div className="mt-4 flex flex-wrap gap-4">
        {rasterUrl && <a href={rasterUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-xs text-primary hover:underline"><Download className="size-3.5"/>Download derived change GeoTIFF</a>}
        {screeningMaskUrl && <a href={screeningMaskUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-xs text-primary hover:underline"><Download className="size-3.5"/>Download negative-change screening mask</a>}
        {uncertaintyUrl && <a href={uncertaintyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-xs text-primary hover:underline"><Download className="size-3.5"/>Download measurement-noise diagnostic COG</a>}
        {waterScreeningMaskUrl && <a href={waterScreeningMaskUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-xs text-primary hover:underline"><Download className="size-3.5"/>Download provisional JRC-informed candidate-water screen</a>}
      </div>
      {job.status === "completed" && summary && <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => void downloadScientificPDF()} className="inline-flex h-9 items-center gap-2 rounded border border-border px-3 text-xs"><Download className="size-3.5"/>Scientific PDF</button>
        <button type="button" onClick={downloadSummaryCSV} className="inline-flex h-9 items-center gap-2 rounded border border-border px-3 text-xs">Summary CSV</button>
        <button type="button" onClick={downloadProvenanceJSON} className="inline-flex h-9 items-center gap-2 rounded border border-border px-3 text-xs">Provenance JSON</button>
      </div>}
      {job.status === "completed" && <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">This is a measured change in gamma0 backscatter, not by itself a water mask, flood extent, or validated hazard finding. The separate candidate-water screen, when available, is provisional and unvalidated. The PNG quicklook is reprojected to WGS84 and registered to its returned bounds for map display. Use the full-resolution GeoTIFF for authoritative GIS analysis. Coverage is calculated only over AOI pixel centres within the returned raster footprint; coverage and percentile diagnostics describe data quality, not calibrated uncertainty.</p>}
      {job.status === "completed" && waterScreening?.available === true && <div className="mt-3 rounded border border-border p-3 text-xs">
        <div className="font-medium">Provisional candidate-water screening</div>
        <div className="mt-1 text-muted-foreground">{formatNumber(waterScreening.candidate_pixels,0)} candidate pixels · {formatNumber(waterScreening.candidate_area_km2,4)} km²</div>
        <p className="mt-2 leading-relaxed text-muted-foreground">This screen combines a fixed, uncalibrated negative-backscatter threshold with JRC historical occurrence and an optional Copernicus GLO-30 surface-slope filter. It is not a validated flood or inundation classification.</p>
      </div>}
      {job.status === "completed" && <div className="mt-4 rounded-lg border border-border bg-background/40 p-3">
        <div className="label-xs text-primary">DATA QUALITY · NOT CONFIDENCE</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div><div className="text-[10px] text-muted-foreground">VALID AOI PIXEL COVERAGE</div><div className="mt-1 font-mono text-sm">{formatNumber(qualityDiagnostics?.valid_pixel_coverage_percent, 1)}%</div></div>
          <div><div className="text-[10px] text-muted-foreground">P10–P90 CHANGE SPREAD</div><div className="mt-1 font-mono text-sm">{formatNumber(qualityDiagnostics?.p10_to_p90_change_span_db)} dB</div></div>
        </div>
        {sensitivity.length > 0 && <div className="mt-3 border-t border-border pt-3">
          <div className="text-[10px] text-muted-foreground">NEGATIVE-BACKSCATTER THRESHOLD SENSITIVITY</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {sensitivity.map((item, index) => <div key={String(item.threshold_db ?? index)} className="rounded border border-border p-2">
              <div className="font-mono text-xs">{formatNumber(item.threshold_db, 1)} dB</div>
              <div className="mt-1 text-sm font-medium">{typeof item.candidate_pixels === "number" ? item.candidate_pixels.toLocaleString() : "—"}</div>
              <div className="text-[10px] text-muted-foreground">pixels below threshold</div>
            </div>)}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">These counts show how the area of negative backscatter change varies with a chosen threshold. They are screening diagnostics only; they do not classify water or flooding.</p>
        </div>}
      </div>}
      {job.status === "completed" && <div className="mt-3 rounded-lg border border-amber/25 bg-amber/5 p-3">
        <div className="label-xs text-amber">WHAT THIRD EYE COULD NOT SEE</div>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-muted-foreground">
          {referenceAgreement?.performed === true ? <li>An OPERA DSWx-S1 reference was compared, but only against the fixed-threshold screening proxy. Its agreement metrics are not flood-classifier accuracy or a calibrated performance claim.</li> : <li>No time-matched independent water reference was available, so precision, recall, F1 and IoU are not available for this job.</li>}
          <li>The optional screening mask marks only pixels below a fixed negative dB threshold; it is not a water, flood, fire, landslide or deformation class.</li>
          <li>No calibrated probability or confidence interval is produced. If both scenes contain aligned number-of-looks data, the separate first-order measurement-noise diagnostic is approximate and is not a formal scene-level uncertainty estimate.</li>
          <li>Backscatter change alone cannot identify its cause. Moisture, roughness, vegetation, surface structure and acquisition conditions can all affect the signal.</li>
          <li>No flood depth, flow direction, impact severity or ground displacement was measured.</li>
        </ul>
      </div>}
      <p className="mt-3 text-[10px] text-subtle">Guest access expires {new Date(job.expiresAt).toLocaleString()} · The access token is held only in this browser session.</p>
    </div>}
  </section>;
}
