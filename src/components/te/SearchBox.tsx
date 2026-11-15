import { useEffect, useRef, useState } from "react";
import { AlertCircle, LoaderCircle, MapPin, Search } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/store";
import { DATASETS } from "@/lib/earth-data";
import { makeAOI, rectangleAOI } from "@/lib/analysis";
import { DEFAULT_NISAR_PRODUCTS } from "@/lib/sar-registry";
import {
  isAntimeridianBBoxQuery,
  isTrackFrameQuery,
  parseLocalGeoQuery,
  type GeoSearchResponse,
  type GeoSearchResult,
} from "@/lib/geocode";

export function SearchBox() {
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [placeSearch, setPlaceSearch] = useState<{ query: string; response?: GeoSearchResponse; error?: string; loading: boolean }>({
    query: "",
    loading: false,
  });
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const debounce = window.setTimeout(() => setTerm(query.trim()), 180);
    return () => window.clearTimeout(debounce);
  }, [query]);

  useEffect(() => {
    if (term.length < 3 || parseLocalGeoQuery(term) || isAntimeridianBBoxQuery(term) || isTrackFrameQuery(term)) {
      setPlaceSearch({ query: term, loading: false });
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setPlaceSearch({ query: term, loading: true });
      const params = new URLSearchParams({ q: term });
      void fetch(`/api/geocode/search?${params.toString()}`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      }).then(async response => {
        const payload = await response.json() as GeoSearchResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error || `Place search returned HTTP ${response.status}.`);
        setPlaceSearch({ query: term, response: payload, loading: false });
      }).catch(error => {
        if (controller.signal.aborted) return;
        setPlaceSearch({
          query: term,
          loading: false,
          error: error instanceof Error ? error.message : "Global place search is unavailable.",
        });
      });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [term]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const state = useApp();
  const localPlace = query.trim() ? parseLocalGeoQuery(query.trim()) : null;
  const activePlaceSearch = placeSearch.query === term ? placeSearch : null;
  const remotePlaces = activePlaceSearch?.response?.results ?? [];
  const isTrackFrame = isTrackFrameQuery(query.trim());
  const isAntimeridianBBox = isAntimeridianBBoxQuery(query.trim());

  const datasets = DATASETS.filter(dataset =>
    `${dataset.id} ${dataset.name} ${dataset.description}`.toLowerCase().includes(term.toLowerCase()),
  );
  const analyses = state.analyses.filter(analysis =>
    `${analysis.kind} ${analysis.aoi.name}`.toLowerCase().includes(term.toLowerCase()),
  );
  const liveEvents = state.liveEvents.filter(event =>
    `${event.title} ${event.region} ${event.sourceLabel} ${event.source}`.toLowerCase().includes(term.toLowerCase()),
  );
  const nisarGranules = state.nisarGranules.filter(granule =>
    `${granule.granuleId} ${granule.productCode} ${granule.collectionShortName} ${granule.title}`.toLowerCase().includes(term.toLowerCase()),
  ).slice(0, 5);

  const done = () => {
    setOpen(false);
    setQuery("");
    setTerm("");
  };

  const focusPlace = (result: GeoSearchResult) => {
    const app = useApp.getState();
    const [west, south, east, north] = result.bbox;
    const aoi = result.geometry && (result.geometry.type === "Polygon" || result.geometry.type === "MultiPolygon")
      ? makeAOI({ type: "Feature", properties: {}, geometry: result.geometry }, result.displayName)
      : rectangleAOI([west, south], [east, north]);
    app.select(null);
    app.setAOI({ ...aoi, name: result.displayName });
    app.setLocationResult(result);
    app.toggleLayer("search-location", true);
    app.select(result.id);
    app.setNISARProductSelection(DEFAULT_NISAR_PRODUCTS);
    app.flyTo({
      lat: result.latitude,
      lng: result.longitude,
      altitude: Math.max(0.03, Math.min(1.5, Math.max(east - west, north - south) / 30)),
    });
    app.toggleLayer("nisar-coverage", true);
    for (const product of DEFAULT_NISAR_PRODUCTS) app.toggleLayer(`prod-${product}`, true);
    void app.refreshLiveData();
    done();
  };

  const selectGranule = (id: string) => {
    useApp.getState().select(id);
    done();
  };

  const hasAnyResult = term.length < 3 || Boolean(localPlace || remotePlaces.length || activePlaceSearch?.loading || activePlaceSearch?.error || isTrackFrame || isAntimeridianBBox) || datasets.length > 0 ||
    analyses.length > 0 || liveEvents.length > 0 || nisarGranules.length > 0;

  return (
    <div className="relative w-full max-w-[420px]">
      <div className="glass flex h-9 items-center gap-2 px-3">
        <Search className="size-3.5 shrink-0 text-subtle" />
        <input
          ref={input}
          aria-label="Global Earth search"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={event => { setQuery(event.target.value); setOpen(true); }}
          placeholder="Search places, NISAR products, lat/lon, DMS, bbox or WKT"
          className="min-w-0 flex-1 bg-transparent text-xs outline-none"
        />
        <kbd className="hidden text-[10px] text-subtle sm:block">Ctrl / ⌘ K</kbd>
      </div>
      {open && term && (
        <div className="glass absolute inset-x-0 top-11 z-50 max-h-[min(70vh,480px)] overflow-y-auto p-2" aria-live="polite">
          {(term.length < 3 || localPlace || remotePlaces.length > 0 || placeSearch.loading || placeSearch.error || isTrackFrame || isAntimeridianBBox) && (
            <>
              <div className="label-xs px-2 py-2">PLACES AND AREAS</div>
              {term.length < 3 && !localPlace && !isTrackFrame && !isAntimeridianBBox && (
                <p className="px-3 py-2 text-xs text-muted-foreground">Enter at least 3 characters to search global place names. Coordinates and supported AOI formats are parsed locally.</p>
              )}
              {localPlace && (
                <Button variant="ghost" className="h-auto w-full justify-start whitespace-normal py-2 text-left text-xs" onClick={() => focusPlace(localPlace)}>
                  <MapPin className="size-3.5 shrink-0 text-primary" />
                  <span className="min-w-0">
                    <span className="block truncate">{localPlace.displayName}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {localPlace.type === "coordinates" ? "User-supplied coordinates · approximate 0.25° search area" : "User-supplied area · bounding-box catalog search"}
                    </span>
                  </span>
                </Button>
              )}
              {remotePlaces.slice(0, 8).map(result => (
                <Button key={result.id} variant="ghost" className="h-auto w-full justify-start whitespace-normal py-2 text-left text-xs" onClick={() => focusPlace(result)}>
                  <MapPin className="size-3.5 shrink-0 text-primary" />
                  <span className="min-w-0">
                    <span className="block truncate">{result.displayName}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {result.type.toUpperCase()} · {result.provider === "photon-osm" ? "Photon / OpenStreetMap" : "GeoNames / Open-Meteo"}
                      {result.extentQuality === "approximate" ? " · approximate search area" : ""}
                    </span>
                  </span>
                </Button>
              ))}
              {activePlaceSearch?.loading && (
                <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />Searching global place indexes…</p>
              )}
              {isTrackFrame && (
                <p className="px-3 py-2 text-xs text-muted-foreground">Track/frame lookup is unavailable: the live catalog does not expose a verified track/frame search index.</p>
              )}
              {isAntimeridianBBox && (
                <p className="px-3 py-2 text-xs text-muted-foreground">Antimeridian-crossing AOIs are not yet split into safe CMR searches. Divide this area into two ordered bounding boxes.</p>
              )}
              {activePlaceSearch?.error && (
                <p className="flex items-center gap-2 px-3 py-2 text-xs text-destructive"><AlertCircle className="size-3.5" />{activePlaceSearch.error}</p>
              )}
              {activePlaceSearch?.response?.warnings.map(warning => (
                <p key={warning} className="px-3 py-1 text-[10px] text-muted-foreground">{warning}</p>
              ))}
              {activePlaceSearch?.response && term.length >= 3 && !localPlace && !isTrackFrame && !activePlaceSearch.loading && !activePlaceSearch.error && remotePlaces.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">No place results. Try a more specific name or enter coordinates, DMS, a bounding box, or a WKT polygon.</p>
              )}
            </>
          )}

          {nisarGranules.length > 0 && (
            <>
              <div className="label-xs px-2 py-2 text-primary">REAL NISAR PRODUCTS · NASA CMR</div>
              {nisarGranules.map(granule => (
                <Button key={granule.id} variant="ghost" className="h-auto w-full justify-start whitespace-normal py-2 text-left text-xs" onClick={() => selectGranule(granule.id)}>
                  <span className="min-w-0">
                    <span className="block font-mono text-primary">{granule.productCode} · {(granule.startDate || "").slice(0, 10) || "DATE N/A"} · {granule.maturity.toUpperCase()}</span>
                    <span className="block break-all text-[10px]">{granule.granuleId}</span>
                  </span>
                </Button>
              ))}
            </>
          )}

          {liveEvents.length > 0 && (
            <>
              <div className="label-xs px-2 py-2 text-ok">LIVE PUBLIC EVENTS</div>
              {liveEvents.slice(0, 4).map(event => (
                <Button key={event.id} variant="ghost" className="h-auto w-full justify-start whitespace-normal py-2 text-left text-xs" onClick={() => selectGranule(event.id)}>
                  {event.title} · {event.source}{event.nisarURCandidate ? " · NISAR UR REVIEW CANDIDATE" : ""}
                </Button>
              ))}
            </>
          )}

          {datasets.length > 0 && (
            <>
              <div className="label-xs px-2 py-2">DATASETS</div>
              {datasets.slice(0, 5).map(dataset => (
                <Button key={dataset.id} asChild variant="ghost" className="w-full justify-start text-xs">
                  <Link to="/data" onClick={done}>{dataset.name} · {dataset.availability}</Link>
                </Button>
              ))}
            </>
          )}

          {analyses.length > 0 && (
            <>
              <div className="label-xs px-2 py-2">ANALYSES</div>
              {analyses.map(analysis => (
                <Button key={analysis.id} asChild variant="ghost" className="w-full justify-start text-xs">
                  <Link to="/analysis/$id" params={{ id: analysis.id }} onClick={done}>{analysis.kind}</Link>
                </Button>
              ))}
            </>
          )}

          {!hasAnyResult && (
            <p className="p-3 text-xs text-muted-foreground">
              No matches in loaded records. Try a place name, coordinates, a NISAR product, or an event.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
