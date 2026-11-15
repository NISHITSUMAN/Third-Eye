import { useState } from "react";
import { ExternalLink, RefreshCw, Satellite } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OPERACatalogCollection } from "@/lib/nasa-cmr";

type CatalogResponse = {
  collections: OPERACatalogCollection[];
  hits: number;
  error?: string;
};

function formatDate(value: string | null) {
  if (!value) return "Not reported";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : value;
}

export function OPERACatalog() {
  const [collections, setCollections] = useState<OPERACatalogCollection[]>([]);
  const [hits, setHits] = useState(0);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const loadCatalog = async () => {
    setStatus("loading");
    setError(null);
    try {
      const response = await fetch("/api/opera/catalog", { headers: { Accept: "application/json" } });
      const payload = await response.json() as CatalogResponse;
      if (!response.ok) throw new Error(payload.error || `NASA CMR returned HTTP ${response.status}.`);
      if (!Array.isArray(payload.collections) || typeof payload.hits !== "number") {
        throw new Error("NASA CMR returned an invalid OPERA catalog response.");
      }
      setCollections(payload.collections);
      setHits(payload.hits);
      setStatus("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "NASA CMR OPERA metadata could not be loaded.");
      setStatus("error");
    }
  };

  return (
    <section className="mt-8 overflow-hidden rounded-xl border border-border bg-panel">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-background/35 p-4 sm:p-5">
        <div className="flex min-w-0 gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
            <Satellite className="size-5" aria-hidden="true" />
          </div>
          <div>
            <div className="label-xs text-primary">NASA EARTHDATA · OPERA</div>
            <h2 className="mt-1 text-lg font-medium">OPERA collection metadata</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              Discover live OPERA collection records from NASA CMR. This view does not download, interpret, or process OPERA rasters.
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void loadCatalog()} disabled={status === "loading"}>
          <RefreshCw className={status === "loading" ? "animate-spin" : ""} />
          {status === "loading" ? "QUERYING CMR…" : status === "ready" ? "REFRESH OPERA" : "LOAD OPERA CATALOG"}
        </Button>
      </header>
      <div className="space-y-3 p-4 sm:p-5">
        {status === "idle" && <p className="text-xs text-muted-foreground">Load NASA’s current OPERA collection metadata to see available product families and reported date ranges.</p>}
        {status === "loading" && <p role="status" className="text-xs text-muted-foreground">Requesting OPERA collection metadata from NASA CMR…</p>}
        {error && <p role="alert" className="rounded border border-alert/40 bg-alert/5 p-3 text-xs text-alert">{error}</p>}
        {status === "ready" && (
          <>
            <p className="text-xs text-muted-foreground">{collections.length} collection records loaded · {hits.toLocaleString()} matches reported by CMR.</p>
            {collections.length === 0 && <p className="rounded border border-dashed border-border p-3 text-xs text-muted-foreground">CMR reported no OPERA collections with granules in this response.</p>}
            <div className="grid gap-3 xl:grid-cols-2">
              {collections.map(collection => (
                <article key={collection.conceptId} className="rounded-lg border border-border bg-background/25 p-3">
                  <div className="font-mono text-[10px] text-primary">{collection.shortName}</div>
                  <h3 className="mt-1 text-sm font-medium">{collection.title}</h3>
                  <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{collection.abstract || "No abstract was supplied in the CMR record."}</p>
                  <div className="mt-3 font-mono text-[9px] text-subtle">{collection.processingLevel || "LEVEL NOT REPORTED"} · {formatDate(collection.startDate)} — {formatDate(collection.endDate)}</div>
                  <div className="mt-3 flex flex-wrap gap-4">
                    <a href={collection.metadataUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">CMR metadata <ExternalLink className="size-3" /></a>
                    <a href={collection.earthdataSearchUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">Earthdata Search <ExternalLink className="size-3" /></a>
                  </div>
                </article>
              ))}
            </div>
            <p className="font-mono text-[9px] leading-relaxed text-subtle">CATALOG METADATA ONLY · A LISTED COLLECTION DOES NOT MEAN THAT ITS RASTER HAS BEEN DOWNLOADED OR ANALYZED BY THIS APP.</p>
          </>
        )}
      </div>
    </section>
  );
}
