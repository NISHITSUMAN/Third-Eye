import { useEffect, useRef, useState } from "react";
import maplibregl, { type RasterSourceSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useApp, visibleEvents } from "@/lib/store";
import { eventOpacity } from "@/lib/earth-data";
import { phenomenonColor } from "@/lib/earth-vocabulary";
import {
  buildGeographicResults,
  geographicPointFeatureCollection,
  geographicShapeFeatureCollection,
} from "@/lib/geographic-results";
import type { PlanetaryComputerVisualization } from "@/lib/planetary-computer";
import type { ScientificJob } from "@/lib/scientific-jobs";

type MapStatus = "loading" | "ready" | "fallback" | "error";

const BASEMAPS: { id: string; label: string; source: RasterSourceSpecification }[] = [
  {
    id: "osm",
    label: "OpenStreetMap",
    source: {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  {
    id: "carto",
    label: "CARTO Dark",
    source: {
      type: "raster" as const,
      tiles: ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
  },
  {
    id: "esri",
    label: "Esri World Imagery",
    source: {
      type: "raster" as const,
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      attribution: "Tiles © Esri — Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    },
  },
];
const planetaryImageryKeys = new WeakMap<maplibregl.Map, string>();
const scientificResultKeys = new WeakMap<maplibregl.Map, string>();
const AGENT_RANK_COLORS = ["#54D68A", "#25D9FF", "#FFB547", "#C2A8FF"];

function syncPlanetaryImagery(
  map: maplibregl.Map,
  visualization: PlanetaryComputerVisualization | null,
  enabled: boolean,
  opacity: number,
) {
  const layerId = "selected-imagery-layer";
  const sourceId = "selected-imagery-source";
  const existing = map.getSource(sourceId);
  const wanted = enabled ? visualization : null;
  if (!wanted) {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    planetaryImageryKeys.delete(map);
    return;
  }
  const key = `${wanted.itemId}:${wanted.tiles[0]}:${wanted.bounds.join(",")}`;
  if (existing && planetaryImageryKeys.get(map) !== key) {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    map.removeSource(sourceId);
    planetaryImageryKeys.delete(map);
  }
  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, {
      type: "raster",
      tiles: [...wanted.tiles],
      tileSize: 256,
      bounds: [...wanted.bounds],
      attribution: wanted.attribution,
      minzoom: wanted.minZoom ?? 0,
      maxzoom: wanted.maxZoom ?? 22,
    });
    planetaryImageryKeys.set(map, key);
  }
  if (!map.getLayer(layerId)) {
    const before = map.getLayer("nisar-coverage-fill") ? "nisar-coverage-fill" : undefined;
    map.addLayer({
      id: layerId,
      type: "raster",
      source: sourceId,
      paint: { "raster-opacity": Math.max(0, Math.min(1, opacity / 100)) },
    }, before);
  } else {
    map.setPaintProperty(layerId, "raster-opacity", Math.max(0, Math.min(1, opacity / 100)));
  }
}

function syncScientificResult(
  map: maplibregl.Map,
  job: ScientificJob | null,
  previewUrl: string | null,
  enabled: boolean,
  opacity: number,
) {
  const layerId = "scientific-result-layer";
  const sourceId = "scientific-result-source";
  const sourceExists = map.getSource(sourceId);
  const result = enabled && job?.status === "completed" ? job.result : null;
  if (!result || !previewUrl) {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    scientificResultKeys.delete(map);
    return;
  }
  const key = `${job.id}:${previewUrl}`;
  if (sourceExists && scientificResultKeys.get(map) !== key) {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    map.removeSource(sourceId);
    scientificResultKeys.delete(map);
  }
  if (!map.getSource(sourceId)) {
    const [west, south, east, north] = result.bounds;
    map.addSource(sourceId, {
      type: "image",
      url: previewUrl,
      coordinates: [[west, north], [east, north], [east, south], [west, south]],
    });
    scientificResultKeys.set(map, key);
  }
  if (!map.getLayer(layerId)) {
    map.addLayer({
      id: layerId,
      type: "raster",
      source: sourceId,
      paint: { "raster-opacity": Math.max(0, Math.min(1, opacity / 100)) },
    }, map.getLayer("nisar-coverage-fill") ? "nisar-coverage-fill" : undefined);
  } else {
    map.setPaintProperty(layerId, "raster-opacity", Math.max(0, Math.min(1, opacity / 100)));
  }
}

export default function EarthMap({ compact = false }: { compact?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const activeBasemapRef = useRef(0);
  const probeBasemapRef = useRef<((index: number) => void) | null>(null);
  const [mapStatus, setMapStatus] = useState<MapStatus>("loading");
  const [mapError, setMapError] = useState("");
  const layers = useApp(s => s.layers);
  const filter = useApp(s => s.filter);
  const time = useApp(s => s.time);
  const aoi = useApp(s => s.aoi);
  const lod = useApp(s => s.lod);
  const selected = useApp(s => s.selectedId);
  const drawTool = useApp(s => s.drawTool);
  const drawingPoints = useApp(s => s.drawingPoints);
  const nonce = useApp(s => s.viewNonce);
  const opacity = useApp(s => s.opacity);
  const liveEvents = useApp(s => s.liveEvents);
  const nisarGranules = useApp(s => s.nisarGranules);
  const planetaryComputerResult = useApp(s => s.planetaryComputerResult);
  const agentFindings = useApp(s => s.agentFindings);
  const activeIntelligenceWorkflowId = useApp(s => s.activeIntelligenceWorkflowId);
  const planetaryVisualization = useApp(s => s.planetaryVisualization);
  const selectedImageryEnabled = useApp(s => s.layers.has("selected-imagery"));
  const selectedImageryOpacity = useApp(s => s.opacity["selected-imagery"] ?? 75);
  const scientificJob = useApp(s => s.scientificJob);
  const scientificJobPreviewUrl = useApp(s => s.scientificJobPreviewUrl);

  const update = () => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;

    const state = useApp.getState();
    const results = buildGeographicResults(state);
    (map.getSource("live-events") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: [
        ...geographicPointFeatureCollection(results, state.selectedId, "live-usgs").features,
        ...geographicPointFeatureCollection(results, state.selectedId, "live-eonet").features,
      ],
    });
    (map.getSource("live-event-shapes") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: [
        ...geographicShapeFeatureCollection(results, state.selectedId, "live-usgs").features,
        ...geographicShapeFeatureCollection(results, state.selectedId, "live-eonet").features,
      ],
    });
    (map.getSource("nisar-coverage") as maplibregl.GeoJSONSource | undefined)?.setData(
      geographicShapeFeatureCollection(results, state.selectedId, "nisar-coverage"),
    );
    (map.getSource("nisar-coverage-points") as maplibregl.GeoJSONSource | undefined)?.setData(
      geographicPointFeatureCollection(results, state.selectedId, "nisar-coverage"),
    );
    (map.getSource("planetary-observations") as maplibregl.GeoJSONSource | undefined)?.setData(
      geographicShapeFeatureCollection(results, state.selectedId, "planetary-observations"),
    );
    (map.getSource("planetary-observation-points") as maplibregl.GeoJSONSource | undefined)?.setData(
      geographicPointFeatureCollection(results, state.selectedId, "planetary-observations"),
    );
    (map.getSource("search-location") as maplibregl.GeoJSONSource | undefined)?.setData(
      geographicPointFeatureCollection(results, state.selectedId, "search-location"),
    );
    (map.getSource("agent-findings") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: state.agentFindings.map(finding => ({
        type: "Feature" as const,
        properties: {
          id: finding.id,
          rank: finding.rank,
          selected: finding.id === state.selectedId,
          color: AGENT_RANK_COLORS[finding.rank - 1] ?? "#C2A8FF",
        },
        geometry: { type: "Point" as const, coordinates: [finding.longitude, finding.latitude] },
      })),
    });
    (map.getSource("agent-finding-shapes") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: state.agentFindings.flatMap(finding =>
        finding.geometry && (finding.geometry.type === "Polygon" || finding.geometry.type === "MultiPolygon")
          ? [{
            type: "Feature" as const,
            properties: {
              id: finding.id,
              rank: finding.rank,
              selected: finding.id === state.selectedId,
              color: AGENT_RANK_COLORS[finding.rank - 1] ?? "#C2A8FF",
            },
            geometry: finding.geometry,
          }]
          : [],
      ),
    });
    (map.getSource("current-aoi") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: state.aoi ? [state.aoi.feature] : [],
    });
    const drawingFeatures = state.drawingPoints.length === 1
      ? [{
          type: "Feature" as const,
          properties: {},
          geometry: { type: "Point" as const, coordinates: state.drawingPoints[0]! },
        }]
      : state.drawingPoints.length > 1
        ? [{
            type: "Feature" as const,
            properties: {},
            geometry: { type: "LineString" as const, coordinates: state.drawingPoints },
          }]
        : [];
    (map.getSource("aoi-drawing") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: drawingFeatures,
    });

    const events = visibleEvents(state);
    const pointData = {
      type: "FeatureCollection" as const,
      features: events.map(event => ({
        type: "Feature" as const,
        properties: {
          id: event.id,
          color: phenomenonColor(event.type),
          alpha: eventOpacity(event) * ((state.opacity[event.type] ?? 100) / 100),
          selected: event.id === state.selectedId,
        },
        geometry: { type: "Point" as const, coordinates: [event.lng, event.lat] },
      })),
    };
    const polygonData = {
      type: "FeatureCollection" as const,
      features: state.layers.has("nisar-footprints")
        ? events.map(event => ({
            type: "Feature" as const,
            properties: { id: event.id, selected: event.id === state.selectedId },
            geometry: {
              type: "Polygon" as const,
              coordinates: [[
                ...event.geometry.coordinates,
                ...(event.geometry.coordinates[0] ? [event.geometry.coordinates[0]] : []),
              ].map(point => [point.lng, point.lat])],
            },
          }))
        : [],
    };
    (map.getSource("events") as maplibregl.GeoJSONSource | undefined)?.setData(pointData);
    (map.getSource("footprints") as maplibregl.GeoJSONSource | undefined)?.setData(polygonData);

    const detailed = state.lod !== "global" ? "visible" : "none";
    for (const id of [
      "live-event-shape-fill", "live-event-shape-outline", "nisar-coverage-fill",
      "nisar-coverage-bounds-outline",
      "planetary-observation-fill", "planetary-observation-outline",
      "planetary-observation-bounds-outline",
    ]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", detailed);
    }
    if (map.getLayer("nisar-coverage-outline")) {
      map.setLayoutProperty("nisar-coverage-outline", "visibility", "visible");
    }
    if (map.getLayer("aoi-outline")) map.setLayoutProperty("aoi-outline", "visibility", "visible");
    for (const id of [
      "live-event-clusters", "live-event-cluster-count", "live-event-points",
      "nisar-catalog-clusters", "nisar-catalog-cluster-count", "nisar-catalog-points",
      "planetary-observation-clusters", "planetary-observation-cluster-count", "planetary-observation-points",
      "search-location-point",
    ]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible");
    }

    syncPlanetaryImagery(
      map,
      state.planetaryVisualization,
      state.layers.has("selected-imagery"),
      state.opacity["selected-imagery"] ?? 75,
    );
    syncScientificResult(
      map,
      state.scientificJob,
      state.scientificJobPreviewUrl,
      state.layers.has("scientific-result"),
      state.opacity["scientific-result"] ?? 75,
    );
  };

  useEffect(() => {
    if (!el.current) return;
    let map: maplibregl.Map;
    activeBasemapRef.current = 0;
    setMapStatus("loading");
    setMapError("");

    const sources: Record<string, maplibregl.SourceSpecification> = {};
    const styleLayers: maplibregl.LayerSpecification[] = [];
    BASEMAPS.forEach((basemap, index) => {
      sources[`base-${basemap.id}`] = { ...basemap.source, tiles: [...(basemap.source.tiles ?? [])] };
      styleLayers.push({
        id: `base-layer-${basemap.id}`,
        type: "raster",
        source: `base-${basemap.id}`,
        layout: { visibility: index === 0 ? "visible" : "none" },
      });
    });

    const view = useApp.getState().view;
    try {
      map = new maplibregl.Map({
        container: el.current,
        center: [view.lng, view.lat],
        zoom: Math.max(1, 4 - Math.log2(view.altitude * 4)),
        attributionControl: { compact: true },
        style: {
          version: 8,
          sources: {},
          layers: [{
            id: "earth-background",
            type: "background",
            paint: { "background-color": "#0B1218" },
          }],
        },
        maxZoom: 18,
        minZoom: 1,
        trackResize: true,
      });
    } catch (error) {
      setMapStatus("error");
      setMapError(error instanceof Error ? error.message : "The 2D map could not be started in this browser.");
      return;
    }
    mapRef.current = map;
    let rendererLoaded = false;
    let rendererLoadTimer: number | null = null;
    const checkRendererLoad = () => {
      rendererLoadTimer = null;
      if (rendererLoaded) return;
      if (document.visibilityState === "hidden") {
        rendererLoadTimer = window.setTimeout(checkRendererLoad, 12000);
        return;
      }
      setMapStatus("error");
      setMapError("The 2D map renderer did not initialize. Retry the map or switch to 3D Earth.");
    };
    rendererLoadTimer = window.setTimeout(checkRendererLoad, 12000);
    let basemapReadinessTimer: number | null = null;
    const clearBasemapReadinessTimer = () => {
      if (basemapReadinessTimer === null) return;
      window.clearTimeout(basemapReadinessTimer);
      basemapReadinessTimer = null;
    };

    const setActiveBasemap = (index: number) => {
      const validIndex = Math.max(0, Math.min(BASEMAPS.length - 1, index));
      const mapConfig = BASEMAPS[validIndex];
      if (!mapConfig) return;
      clearBasemapReadinessTimer();
      activeBasemapRef.current = validIndex;
      BASEMAPS.forEach((basemap, layerIndex) => {
        const layerId = `base-layer-${basemap.id}`;
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, "visibility", layerIndex === validIndex ? "visible" : "none");
        }
      });
      if (validIndex === 0) {
        setMapStatus("loading");
        setMapError("");
      } else {
        setMapStatus("fallback");
        setMapError(`The previous map tile source failed. Trying ${mapConfig.label}.`);
      }
      map.resize();
      map.triggerRepaint();
    };

    const probeBasemap = (index: number) => {
      if (index >= BASEMAPS.length) {
        setMapStatus("error");
        setMapError("All free map tile sources failed to load. Check your connection and try again.");
        return;
      }
      const mapConfig = BASEMAPS[index];
      if (!mapConfig) {
        setMapStatus("error");
        setMapError("The requested map source is unavailable.");
        return;
      }
      setActiveBasemap(index);
      const sourceId = `base-${mapConfig.id}`;
      if (!map.getSource(sourceId)) {
        setMapStatus("error");
        setMapError(`The ${mapConfig.label} map source could not be initialized.`);
        return;
      }
      const checkBasemapReadiness = () => {
        basemapReadinessTimer = null;
        if (activeBasemapRef.current !== index) return;
        if (document.visibilityState === "hidden") {
          basemapReadinessTimer = window.setTimeout(checkBasemapReadiness, 9000);
          return;
        }
        if (map.isSourceLoaded(sourceId)) {
          setMapStatus("error");
          setMapError("The map tiles loaded, but the 2D map did not finish rendering. Retry or switch map mode.");
          return;
        }
        console.warn(`2D basemap ${mapConfig.label} did not finish loading its visible tiles.`);
        probeBasemap(index + 1);
      };
      basemapReadinessTimer = window.setTimeout(checkBasemapReadiness, 9000);
    };
    probeBasemapRef.current = probeBasemap;

    const onMapIdle = () => {
      const activeBasemap = BASEMAPS[activeBasemapRef.current];
      if (!activeBasemap || !map.isSourceLoaded(`base-${activeBasemap.id}`)) return;
      clearBasemapReadinessTimer();
      setMapStatus("ready");
      setMapError("");
    };
    map.on("idle", onMapIdle);
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      map.resize();
      map.triggerRepaint();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    const onMapError = (event: unknown) => {
      const detail = event as { error?: { message?: string; url?: string } };
      const message = `${detail.error?.message ?? ""} ${detail.error?.url ?? ""}`;
      const active = BASEMAPS[activeBasemapRef.current];
      const activeTile = active?.source.tiles?.[0];
      const host = activeTile ? new URL(activeTile).hostname : "";
      // Ignore unrelated style/data errors; the tile probe handles generic network failures.
      if (!host || !message.includes(host)) return;
      const nextIndex = activeBasemapRef.current + 1;
      if (nextIndex < BASEMAPS.length) probeBasemap(nextIndex);
      else {
        setMapStatus("error");
        setMapError("All free map tile sources failed to load. Check your connection and try again.");
      }
    };
    map.on("error", onMapError);

    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => map.resize())
      : null;
    if (resizeObserver && el.current) resizeObserver.observe(el.current);
    map.on("load", () => {
      rendererLoaded = true;
      if (rendererLoadTimer !== null) {
        window.clearTimeout(rendererLoadTimer);
        rendererLoadTimer = null;
      }
      Object.entries(sources).forEach(([id, source]) => map.addSource(id, source));
      styleLayers.forEach(layer => map.addLayer(layer));
      setMapStatus("loading");
      map.resize();
      window.requestAnimationFrame(() => map.resize());

      const selection = getComputedStyle(document.documentElement).getPropertyValue("--earth-selection").trim() || "#25D9FF";
      map.addSource("events", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("footprints", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("live-events", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterRadius: 42,
        clusterMaxZoom: 4,
      });
      map.addSource("live-event-shapes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("nisar-coverage", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("nisar-coverage-points", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterRadius: 42,
        clusterMaxZoom: 4,
      });
      map.addSource("planetary-observations", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("planetary-observation-points", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterRadius: 42,
        clusterMaxZoom: 4,
      });
      map.addSource("search-location", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("agent-findings", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("agent-finding-shapes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("current-aoi", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("aoi-drawing", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "aoi-outline",
        type: "line",
        source: "current-aoi",
        paint: { "line-color": selection, "line-width": 1.5, "line-opacity": 0.75, "line-dasharray": [2, 2] },
      });
      map.addLayer({
        id: "aoi-point",
        type: "circle",
        source: "current-aoi",
        filter: ["==", ["geometry-type"], "Point"],
        paint: { "circle-color": selection, "circle-radius": 7, "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 2 },
      });
      map.addLayer({
        id: "aoi-drawing-line",
        type: "line",
        source: "aoi-drawing",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": selection, "line-width": 2, "line-dasharray": [2, 2] },
      });
      map.addLayer({
        id: "aoi-drawing-points",
        type: "circle",
        source: "aoi-drawing",
        filter: ["==", ["geometry-type"], "Point"],
        paint: { "circle-color": selection, "circle-radius": 5, "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 1.5 },
      });
      map.addLayer({
        id: "live-event-shape-fill",
        type: "fill",
        source: "live-event-shapes",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          "fill-color": ["coalesce", ["get", "color"], "#E4AA4F"],
          "fill-opacity": ["case", ["get", "selected"], 0.18, 0.08],
        },
      });
      map.addLayer({
        id: "live-event-shape-outline",
        type: "line",
        source: "live-event-shapes",
        paint: {
          "line-color": ["coalesce", ["get", "color"], "#E4AA4F"],
          "line-width": ["case", ["get", "selected"], 2.5, 1.3],
          "line-opacity": 0.9,
        },
      });
      map.addLayer({
        id: "nisar-coverage-fill",
        type: "fill",
        source: "nisar-coverage",
        filter: ["==", ["get", "extentType"], "source-footprint"],
        paint: {
          "fill-color": ["coalesce", ["get", "color"], "#2EC4FF"],
          "fill-opacity": ["case", ["get", "selected"], 0.18, 0.11],
        },
      });
      map.addLayer({
        id: "nisar-coverage-outline",
        type: "line",
        source: "nisar-coverage",
        filter: ["==", ["get", "extentType"], "source-footprint"],
        paint: {
          "line-color": ["coalesce", ["get", "color"], "#2EC4FF"],
          "line-width": ["case", ["get", "selected"], 3, ["interpolate", ["linear"], ["zoom"], 1, 0.7, 5, 1.5]],
          "line-opacity": ["case", ["get", "selected"], 0.98, ["interpolate", ["linear"], ["zoom"], 1, 0.55, 5, 0.96]],
        },
      });
      map.addLayer({
        id: "nisar-coverage-bounds-outline",
        type: "line",
        source: "nisar-coverage",
        filter: ["==", ["get", "extentType"], "bounding-box"],
        paint: {
          "line-color": ["coalesce", ["get", "color"], "#88DFFF"],
          "line-width": ["case", ["get", "selected"], 2.5, 1.1],
          "line-opacity": 0.72,
          "line-dasharray": [2, 2],
        },
      });
      map.addLayer({
        id: "nisar-catalog-clusters",
        type: "circle",
        source: "nisar-coverage-points",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#2EC4FF",
          "circle-opacity": 0.78,
          "circle-radius": ["step", ["get", "point_count"], 12, 10, 16, 30, 21],
          "circle-stroke-color": "#DDF7FF",
          "circle-stroke-width": 1,
        },
      });
      map.addLayer({
        id: "nisar-catalog-cluster-count",
        type: "symbol",
        source: "nisar-coverage-points",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 10,
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        },
        paint: { "text-color": "#05121B" },
      });
      map.addLayer({
        id: "nisar-catalog-points",
        type: "circle",
        source: "nisar-coverage-points",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": ["coalesce", ["get", "color"], "#2EC4FF"],
          "circle-radius": 4,
          "circle-stroke-color": "#DDF7FF",
          "circle-stroke-width": 1,
        },
      });
      map.addLayer({
        id: "live-event-clusters",
        type: "circle",
        source: "live-events",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#E4AA4F",
          "circle-opacity": 0.84,
          "circle-radius": ["step", ["get", "point_count"], 12, 10, 16, 30, 21],
          "circle-stroke-color": "#FFF4DB",
          "circle-stroke-width": 1,
        },
      });
      map.addLayer({
        id: "live-event-cluster-count",
        type: "symbol",
        source: "live-events",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 10,
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        },
        paint: { "text-color": "#1B170E" },
      });
      map.addLayer({
        id: "planetary-observation-fill",
        type: "fill",
        source: "planetary-observations",
        filter: ["!=", ["get", "extentType"], "bounding-box"],
        paint: { "fill-color": "#E9A66F", "fill-opacity": 0.08 },
      });
      map.addLayer({
        id: "planetary-observation-bounds-outline",
        type: "line",
        source: "planetary-observations",
        filter: ["==", ["get", "extentType"], "bounding-box"],
        paint: {
          "line-color": "#F3C195",
          "line-width": ["case", ["get", "selected"], 2.5, 1.1],
          "line-opacity": 0.78,
          "line-dasharray": [2, 2],
        },
      });
      map.addLayer({
        id: "planetary-observation-outline",
        type: "line",
        source: "planetary-observations",
        filter: ["!=", ["get", "extentType"], "bounding-box"],
        paint: {
          "line-color": "#E9A66F",
          "line-width": ["case", ["get", "selected"], 2.8, 1.3],
          "line-opacity": 0.88,
        },
      });
      map.addLayer({
        id: "planetary-observation-points",
        type: "circle",
        source: "planetary-observation-points",
        paint: {
          "circle-color": "#E9A66F",
          "circle-radius": ["case", ["get", "selected"], 6, 4],
          "circle-stroke-color": "#FFF0E0",
          "circle-stroke-width": 1,
        },
      });
      map.addLayer({
        id: "planetary-observation-clusters",
        type: "circle",
        source: "planetary-observation-points",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#E9A66F",
          "circle-opacity": 0.86,
          "circle-radius": ["step", ["get", "point_count"], 12, 10, 16, 30, 21],
          "circle-stroke-color": "#FFF0E0",
          "circle-stroke-width": 1,
        },
      });
      map.addLayer({
        id: "planetary-observation-cluster-count",
        type: "symbol",
        source: "planetary-observation-points",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 10,
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        },
        paint: { "text-color": "#21160D" },
      });
      map.addLayer({
        id: "footprint-fill",
        type: "fill",
        source: "footprints",
        paint: { "fill-color": selection, "fill-opacity": 0.07 },
      });
      map.addLayer({
        id: "footprint-outline",
        type: "line",
        source: "footprints",
        paint: {
          "line-color": selection,
          "line-width": ["case", ["get", "selected"], 2, 1],
          "line-opacity": 0.65,
        },
      });
      map.addLayer({
        id: "event-points",
        type: "circle",
        source: "events",
        paint: {
          "circle-color": ["get", "color"],
          "circle-opacity": ["get", "alpha"],
          "circle-radius": ["case", ["get", "selected"], 7, 4],
          "circle-stroke-color": selection,
          "circle-stroke-width": ["case", ["get", "selected"], 2, 0],
        },
      });
      map.addLayer({
        id: "live-event-points",
        type: "circle",
        source: "live-events",
        paint: {
          "circle-color": ["case", ["get", "selected"], selection, ["coalesce", ["get", "color"], "#E4AA4F"]],
          "circle-opacity": 0.92,
          "circle-radius": ["case", ["get", "selected"], 8, 5],
          "circle-stroke-color": "#F7FAFC",
          "circle-stroke-width": ["case", ["get", "selected"], 2, 1],
        },
      });
      map.addLayer({
        id: "search-location-point",
        type: "circle",
        source: "search-location",
        paint: {
          "circle-color": selection,
          "circle-radius": ["case", ["get", "selected"], 8, 6],
          "circle-stroke-color": "#F3FBFF",
          "circle-stroke-width": 2,
          "circle-opacity": 0.96,
        },
      });
      map.addLayer({
        id: "agent-finding-shape-fill",
        type: "fill",
        source: "agent-finding-shapes",
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": ["case", ["get", "selected"], 0.22, 0.09],
        },
      });
      map.addLayer({
        id: "agent-finding-shape-outline",
        type: "line",
        source: "agent-finding-shapes",
        paint: {
          "line-color": ["case", ["get", "selected"], selection, ["get", "color"]],
          "line-width": ["case", ["get", "selected"], 2.5, 1.4],
          "line-opacity": 0.95,
        },
      });
      map.addLayer({
        id: "agent-finding-points",
        type: "circle",
        source: "agent-findings",
        paint: {
          "circle-color": [
            "match", ["get", "rank"],
            1, "#54D68A",
            2, "#25D9FF",
            3, "#FFB547",
            "#C2A8FF",
          ],
          "circle-radius": ["case", ["get", "selected"], 10, 7],
          "circle-stroke-color": "#071017",
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "agent-finding-ranks",
        type: "symbol",
        source: "agent-findings",
        layout: {
          "text-field": ["to-string", ["get", "rank"]],
          "text-size": 10,
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#071017" },
      });

      update();

      const selectClickedResult = (event: maplibregl.MapLayerMouseEvent) => {
        const state = useApp.getState();
        if (state.drawTool) return;
        const id = event.features?.[0]?.properties?.["id"];
        if (typeof id === "string") state.select(id);
      };
      for (const layer of [
        "event-points", "footprint-fill", "live-event-points",
        "nisar-coverage-fill", "nisar-coverage-outline", "nisar-coverage-bounds-outline",
        "nisar-catalog-points",
      ]) {
        map.on("click", layer, selectClickedResult);
      }
      for (const layer of [
        "planetary-observation-fill", "planetary-observation-outline",
        "planetary-observation-bounds-outline", "planetary-observation-points",
      ]) {
        map.on("click", layer, selectClickedResult);
      }
      for (const layer of [
        "live-event-shape-fill", "live-event-shape-outline", "search-location-point",
        "agent-finding-shape-fill", "agent-finding-shape-outline",
        "agent-finding-points", "agent-finding-ranks",
      ]) {
        map.on("click", layer, selectClickedResult);
      }
      map.on("click", event => {
        const state = useApp.getState();
        if (state.drawTool) {
          state.addDrawingPoint([event.lngLat.lng, event.lngLat.lat]);
          return;
        }
        const selectableLayers = [
          "event-points",
          "footprint-fill",
          "live-event-points",
          "nisar-coverage-fill",
          "nisar-coverage-outline",
          "nisar-coverage-bounds-outline",
          "nisar-catalog-clusters",
          "nisar-catalog-cluster-count",
          "nisar-catalog-points",
          "planetary-observation-fill",
          "planetary-observation-outline",
          "planetary-observation-bounds-outline",
          "planetary-observation-points",
          "live-event-shape-fill",
          "live-event-shape-outline",
          "live-event-clusters",
          "live-event-cluster-count",
          "planetary-observation-clusters",
          "planetary-observation-cluster-count",
          "search-location-point",
          "agent-finding-shape-fill",
          "agent-finding-shape-outline",
          "agent-finding-points",
          "agent-finding-ranks",
        ];
        const clusterFeature = map.queryRenderedFeatures(event.point, {
          layers: [
            "nisar-catalog-clusters", "nisar-catalog-cluster-count",
            "live-event-clusters", "live-event-cluster-count",
            "planetary-observation-clusters", "planetary-observation-cluster-count",
          ],
        })[0];
        const clusterId = clusterFeature?.properties?.["cluster_id"];
        if (typeof clusterId === "number") {
          const layerId = clusterFeature?.layer.id;
          const sourceId = layerId?.startsWith("live-event-")
            ? "live-events"
            : layerId?.startsWith("planetary-observation-")
              ? "planetary-observation-points"
              : "nisar-coverage-points";
          const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
          void source?.getClusterExpansionZoom(clusterId).then(zoom => {
            map.easeTo({ center: event.lngLat, zoom });
          }).catch(error => {
            console.warn("NISAR catalog cluster could not be expanded.", error);
          });
          return;
        }
        if (map.queryRenderedFeatures(event.point, { layers: selectableLayers }).length) return;
        void useApp.getState().lookupLocation(event.lngLat.lat, event.lngLat.lng);
      });
      map.on("mousemove", () => {
        if (useApp.getState().drawTool) map.getCanvas().style.cursor = "crosshair";
      });
      map.on("mouseenter", "nisar-catalog-clusters", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "nisar-catalog-clusters", () => { map.getCanvas().style.cursor = "grab"; });
      map.on("mouseenter", "nisar-catalog-cluster-count", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "nisar-catalog-cluster-count", () => { map.getCanvas().style.cursor = "grab"; });
      map.on("mouseenter", "nisar-catalog-points", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "nisar-catalog-points", () => { map.getCanvas().style.cursor = "grab"; });
      map.on("mouseenter", "nisar-coverage-bounds-outline", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "nisar-coverage-bounds-outline", () => { map.getCanvas().style.cursor = "grab"; });
      map.on("mouseenter", "nisar-coverage-fill", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "nisar-coverage-fill", () => { map.getCanvas().style.cursor = "grab"; });
      for (const layer of [
        "planetary-observation-fill", "planetary-observation-outline",
        "planetary-observation-bounds-outline", "planetary-observation-points",
      ]) {
        map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = "grab"; });
      }
      for (const layer of [
        "live-event-shape-fill", "live-event-shape-outline", "search-location-point",
        "agent-finding-shape-fill", "agent-finding-shape-outline",
        "agent-finding-points", "agent-finding-ranks",
        "live-event-clusters", "live-event-cluster-count",
        "planetary-observation-clusters", "planetary-observation-cluster-count",
      ]) {
        map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = "grab"; });
      }
      map.on("mouseenter", "live-event-points", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "live-event-points", () => { map.getCanvas().style.cursor = "grab"; });
      map.on("mouseenter", "event-points", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "event-points", () => { map.getCanvas().style.cursor = "grab"; });
      probeBasemap(activeBasemapRef.current);

    });

    map.on("moveend", () => {
      const center = map.getCenter();
      useApp.getState().syncView({
        lat: center.lat,
        lng: center.lng,
        altitude: Math.pow(2, 4 - map.getZoom()) / 4,
      });
    });

    return () => {
      resizeObserver?.disconnect();
      if (rendererLoadTimer !== null) window.clearTimeout(rendererLoadTimer);
      clearBasemapReadinessTimer();
      probeBasemapRef.current = null;
      map.off("idle", onMapIdle);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(update, [
    layers, filter, time, aoi, lod, selected, opacity, liveEvents, nisarGranules, drawTool, drawingPoints,
    planetaryComputerResult, activeIntelligenceWorkflowId, planetaryVisualization, agentFindings,
    selectedImageryEnabled, selectedImageryOpacity, scientificJob, scientificJobPreviewUrl,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = drawTool ? "crosshair" : "grab";
  }, [drawTool]);

  useEffect(() => {
    const view = useApp.getState().view;
    mapRef.current?.flyTo({
      center: [view.lng, view.lat],
      zoom: Math.max(1, 4 - Math.log2(view.altitude * 4)),
      duration: 1000,
      essential: false,
    });
  }, [nonce]);

  const retryBasemap = () => {
    const map = mapRef.current;
    setMapError("");
    if (!map || !probeBasemapRef.current || !map.getSource("base-osm")) {
      window.location.reload();
      return;
    }
    map.resize();
    probeBasemapRef.current(0);
  };

  return (
    <div ref={el} className={compact ? "absolute inset-0 earth-renderer earth-renderer-compact" : "absolute inset-0 earth-renderer"} data-earth-engine="maplibre">
      {mapStatus === "loading" && (
        <div className="earth-map-status label-xs" role="status">LOADING 2D MAP…</div>
      )}
      {mapStatus === "fallback" && (
        <div className="earth-map-status label-xs" role="status">SWITCHING TO BACKUP MAP…</div>
      )}
      {mapStatus === "error" && (
        <div className="earth-map-status earth-map-status-error glass" role="status">
          <p>{mapError || "The map could not be loaded."}</p>
          <button type="button" onClick={retryBasemap}>RETRY MAP</button>
          <button type="button" onClick={() => useApp.getState().setEarthMode("3d")}>SWITCH TO 3D EARTH</button>
        </div>
      )}
    </div>
  );
}
