import { useState, type ReactNode } from "react";
import { LoaderCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCoord } from "@/lib/earth-vocabulary";
import { formatDate } from "./observation-format";
import type { ObservationRelatedRecord } from "./useObservationExplanation";

export interface ObservationDetailsProps {
  title: string;
  subtitle: string;
  kindLabel: string;
  dataClass: string;
  source: string;
  sourceUrl: string | null;
  sourceLinks?: Array<{ label: string; url: string }>;
  countryRegion: string | null;
  coordinates: { lat: number; lng: number; approximate: boolean } | null;
  timeline: Array<{ label: string; value: string | null }>;
  aiExplanation?: {
    status: "idle" | "loading" | "ready" | "error";
    explanation: string | null;
    error: string | null;
    relatedRecordCount: number;
    relatedRecordsAnalyzed: number;
    relatedRecords?: ObservationRelatedRecord[];
    retry: () => void;
  };
  explanation: string;
  applications: string[];
  technicalMetadata: Record<string, unknown>;
  integrityNote: string;
  close: () => void;
  extraContent?: ReactNode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function labelFor(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, character => character.toUpperCase());
}

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not reported";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (/^(time|timestamp|created|updated|revisiondate)$/i.test(key) && value > 1_000_000_000_000) {
      return formatDate(new Date(value).toISOString());
    }
    if (/latitude|longitude|coordinate/i.test(key)) return `${value.toFixed(5)}°`;
    return String(value);
  }
  if (typeof value === "string") {
    const time = Date.parse(value);
    if (Number.isFinite(time) && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) {
      return formatDate(value);
    }
    return value;
  }
  return String(value);
}

function MetadataEntry({ label, value, depth = 0 }: { label: string; value: unknown; depth?: number }) {
  if (isRecord(value)) {
    const entries = Object.entries(value);
    return (
      <details open className="min-w-0 rounded border border-border/70 bg-background/25 px-2 py-1.5">
        <summary className="cursor-pointer select-text text-[10px] font-medium text-foreground">
          {labelFor(label)} <span className="font-mono text-[8px] text-subtle">{entries.length} fields</span>
        </summary>
        <div className="mt-1.5 space-y-1.5 border-l border-border pl-2">
          {entries.map(([key, child]) => (
            <MetadataEntry key={`${depth}-${key}`} label={key} value={child} depth={depth + 1} />
          ))}
        </div>
      </details>
    );
  }
  if (Array.isArray(value)) {
    return (
      <details open className="min-w-0 rounded border border-border/70 bg-background/25 px-2 py-1.5">
        <summary className="cursor-pointer select-text text-[10px] font-medium text-foreground">
          {labelFor(label)} <span className="font-mono text-[8px] text-subtle">{value.length} items</span>
        </summary>
        <div className="mt-1.5 space-y-1.5 border-l border-border pl-2">
          {value.map((child, index) => (
            <MetadataEntry key={`${depth}-${label}-${index}`} label={`Item ${index + 1}`} value={child} depth={depth + 1} />
          ))}
        </div>
      </details>
    );
  }
  return (
    <div className="grid min-w-0 grid-cols-[minmax(5rem,0.8fr)_minmax(0,1.4fr)] gap-2 border-b border-border/50 py-1.5 last:border-0">
      <dt className="break-words text-[9px] text-muted-foreground">{labelFor(label)}</dt>
      <dd className="min-w-0 break-all text-[9px] text-foreground/90">{formatValue(label, value)}</dd>
    </div>
  );
}

export function ObservationDetails(props: ObservationDetailsProps) {
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const metadataText = JSON.stringify(props.technicalMetadata, null, 2);
  const relatedRecords = props.aiExplanation?.relatedRecords ?? [];

  const copyMetadata = async () => {
    try {
      await navigator.clipboard.writeText(metadataText);
      setCopyStatus("Metadata copied.");
    } catch (error) {
      setCopyStatus(error instanceof Error ? `Could not copy metadata: ${error.message}` : "Could not copy metadata.");
    }
  };

  return (
    <article className="glass flex max-h-full w-[340px] max-w-[calc(100vw-1.5rem)] animate-fade-up flex-col overflow-hidden">
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="font-mono text-[9px] tracking-[0.16em] text-primary">{props.kindLabel}</div>
          <h2 className="mt-1.5 break-words text-[15px] font-medium leading-snug">{props.title}</h2>
          {props.subtitle && <p className="mt-1 break-words text-[10px] leading-relaxed text-muted-foreground">{props.subtitle}</p>}
        </div>
        <Button variant="ghost" size="icon" onClick={props.close} aria-label="Close observation details" className="size-7 shrink-0 text-subtle hover:text-foreground">
          <span aria-hidden="true">×</span>
        </Button>
      </header>

      <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto p-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded border border-primary/25 bg-primary/5 px-2 py-1 font-mono text-[8px] text-primary">{props.dataClass}</span>
          <span className="rounded border border-border px-2 py-1 font-mono text-[8px] text-muted-foreground">{props.source}</span>
        </div>

        <section id="observation-technical-metadata" className="rounded-md border border-primary/30 bg-primary/[0.045]">
          <Button
            type="button"
            variant="ghost"
            className="h-10 w-full justify-between px-3 text-[10px]"
            aria-expanded={metadataOpen}
            aria-controls="observation-metadata-fields"
            onClick={() => setMetadataOpen(open => !open)}
          >
            <span className="font-medium">{metadataOpen ? "Hide Metadata" : "Check Metadata"}</span>
            <span className="font-mono text-[8px] text-subtle">
              {metadataOpen ? "COLLAPSE" : `${Object.keys(props.technicalMetadata).length} SOURCE SECTIONS`}
            </span>
          </Button>
          <div
            id="observation-metadata-fields"
            hidden={!metadataOpen}
            className="space-y-2 border-t border-border p-2.5"
          >
            {metadataOpen && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[9px] leading-relaxed text-muted-foreground">Complete normalized and provider-returned metadata. These fields describe the catalog record, not a processed measurement.</p>
                  <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 px-2 text-[9px]" onClick={() => void copyMetadata()}>
                    Copy JSON
                  </Button>
                </div>
                {copyStatus && <p role="status" className="text-[9px] text-muted-foreground">{copyStatus}</p>}
                <div className="space-y-1.5">
                  {Object.entries(props.technicalMetadata).map(([key, value]) => (
                    <MetadataEntry key={key} label={key} value={value} />
                  ))}
                </div>
                <details className="rounded border border-border/70 bg-background/25 px-2 py-1.5">
                  <summary className="cursor-pointer text-[9px] font-medium">Raw provider JSON</summary>
                  <pre className="scroll-thin mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-background/40 p-2 font-mono text-[8px] leading-relaxed text-muted-foreground">
                    {metadataText}
                  </pre>
                </details>
              </>
            )}
          </div>
        </section>

        <section className="rounded-md border border-border/80 bg-background/30 p-2.5">
          <h3 className="label-xs">WHERE</h3>
          {props.coordinates ? (
            <>
              <p className="mt-1.5 font-mono text-[11px] text-foreground">{formatCoord(props.coordinates.lat, props.coordinates.lng)}</p>
              <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">
                {props.coordinates.approximate ? "Approximate center of the catalog footprint" : "Reported event coordinates"}
                {props.countryRegion ? ` · ${props.countryRegion}` : " · Country or region not reported"}
              </p>
            </>
          ) : (
            <p className="mt-1.5 text-[10px] text-muted-foreground">Location coordinates were not reported by the source.</p>
          )}
        </section>

        <section className="rounded-md border border-primary/25 bg-primary/[0.04] p-2.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="label-xs text-primary">AI OVERVIEW · SELECTED + RELATED DATA</h3>
            {props.aiExplanation?.status === "loading" && <LoaderCircle className="size-3 animate-spin text-primary" aria-hidden="true" />}
          </div>
          <div aria-live="polite" aria-busy={props.aiExplanation?.status === "loading"}>
            {props.aiExplanation?.status === "ready" && props.aiExplanation.explanation ? (
              <p className="mt-1.5 text-[11px] leading-relaxed text-foreground/90">{props.aiExplanation.explanation}</p>
            ) : props.aiExplanation?.status === "loading" ? (
              <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                Reading this record alongside loaded source records with overlapping reported extents…
              </p>
            ) : props.aiExplanation?.status === "error" ? (
              <div className="mt-1.5 space-y-2">
                <p role="status" className="text-[10px] leading-relaxed text-amber">{props.aiExplanation.error ?? "AI explanation is unavailable."}</p>
                <Button type="button" variant="outline" size="sm" className="h-7 text-[9px]" onClick={props.aiExplanation.retry}>
                  <RotateCw className="size-3" /> Retry AI explanation
                </Button>
              </div>
            ) : (
              <p className="mt-1.5 text-[11px] leading-relaxed text-foreground/90">{props.explanation}</p>
            )}
          </div>
          {props.aiExplanation?.status === "ready" && (
            <p className="mt-2 border-t border-border/70 pt-1.5 text-[9px] leading-relaxed text-subtle">
              AI used this record and {props.aiExplanation.relatedRecordsAnalyzed} loaded record{props.aiExplanation.relatedRecordsAnalyzed === 1 ? "" : "s"} with overlapping reported bounds.
              {props.aiExplanation.relatedRecordCount > props.aiExplanation.relatedRecordsAnalyzed
                ? ` ${props.aiExplanation.relatedRecordCount - props.aiExplanation.relatedRecordsAnalyzed} more loaded matches were outside the request limit.`
                : ""}
              {" "}These are catalog records, not a comparison of raster measurements.
            </p>
          )}
          {props.aiExplanation && props.aiExplanation.status !== "idle" && (
            <div className="mt-2 border-t border-border/70 pt-1.5">
              <p className="label-xs text-subtle">RELATED RECORDS SENT TO AI</p>
              {relatedRecords.length ? (
                <>
                  <ul className="mt-1.5 space-y-1.5">
                    {relatedRecords.slice(0, 3).map(record => (
                      <li key={record.id} className="rounded border border-border/60 bg-background/20 px-2 py-1.5">
                        <p className="break-words text-[9px] font-medium text-foreground">{record.title}</p>
                        <p className="mt-0.5 break-words text-[8px] leading-relaxed text-muted-foreground">
                          {record.date ? formatDate(record.date) : "Date not reported"} · {record.source}
                          {record.product ? ` · ${record.product}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                  {relatedRecords.length > 3 && (
                    <details className="mt-1.5">
                      <summary className="cursor-pointer text-[9px] text-primary">
                        Show {relatedRecords.length - 3} more related records
                      </summary>
                      <ul className="mt-1.5 space-y-1.5">
                        {relatedRecords.slice(3).map(record => (
                          <li key={record.id} className="rounded border border-border/60 bg-background/20 px-2 py-1.5">
                            <p className="break-words text-[9px] font-medium text-foreground">{record.title}</p>
                            <p className="mt-0.5 break-words text-[8px] leading-relaxed text-muted-foreground">
                              {record.date ? formatDate(record.date) : "Date not reported"} · {record.source}
                              {record.product ? ` · ${record.product}` : ""}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <p className="mt-1.5 text-[8px] leading-relaxed text-subtle">
                    Dates identify catalog availability only; overlapping footprints do not establish environmental change.
                  </p>
                </>
              ) : (
                <p className="mt-1.5 text-[9px] leading-relaxed text-muted-foreground">
                  No other loaded records with overlapping reported bounds were available; this overview uses the selected record only.
                </p>
              )}
            </div>
          )}
          {props.aiExplanation?.status === "error" && (
            <details className="mt-2 border-t border-border/70 pt-1.5">
              <summary className="cursor-pointer text-[9px] text-muted-foreground">Show product guide</summary>
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{props.explanation}</p>
            </details>
          )}
        </section>

        <section>
          <h3 className="label-xs">OBSERVATION TIMELINE</h3>
          <dl className="metadata-grid mt-1.5">
            {props.timeline.map(item => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value ?? "Not reported"}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-md border border-primary/20 bg-primary/[0.035] p-2.5">
          <h3 className="label-xs text-primary">WHAT IT MAY HELP RESEARCHERS STUDY</h3>
          {props.applications.length ? (
            <ul className="mt-1.5 space-y-1 text-[10px] leading-relaxed text-muted-foreground">
              {props.applications.map(application => <li key={application}>· {application}</li>)}
            </ul>
          ) : (
            <p className="mt-1.5 text-[10px] text-muted-foreground">The source does not describe a specific research application.</p>
          )}
          <p className="mt-2 border-t border-border/70 pt-1.5 text-[9px] leading-relaxed text-subtle">
            {props.integrityNote.startsWith("NDVI PROCESSING COMPLETED")
              ? "The NDVI measurement above was computed by Third Eye from the selected Sentinel-2 scene and AOI. It is not a crop-health diagnosis."
              : "These are potential uses of the source product, not analyses performed by Third Eye."}
          </p>
        </section>

        {props.extraContent}

        <section className="border-t border-border pt-2.5">
          <h3 className="label-xs">DATA SOURCE</h3>
          <p className="mt-1 text-[10px] text-muted-foreground">{props.source}</p>
          {props.sourceUrl && (
            <a href={props.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex w-full items-center justify-center rounded-md border border-primary/35 px-3 py-2 text-[10px] text-primary hover:bg-primary/10">
              OPEN ORIGINAL SOURCE RECORD ↗
            </a>
          )}
          {props.sourceLinks?.map(link => (
            <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex w-full items-center justify-center rounded-md border border-border px-3 py-2 text-[10px] text-muted-foreground hover:bg-elevated hover:text-foreground">
              {link.label} ↗
            </a>
          ))}
        </section>

        <p className="font-mono text-[8px] leading-relaxed tracking-wider text-subtle">{props.integrityNote}</p>
      </div>
    </article>
  );
}
