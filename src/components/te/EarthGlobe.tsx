import { useEffect, useRef, useState } from "react";
import {
  Viewer,
  Cartesian2,
  Cartesian3,
  Color,
  CustomDataSource,
  EllipsoidTerrainProvider,
  Ellipsoid,
  Cartographic,
  HeightReference,
  Math as CesiumMath,
  HorizontalOrigin,
  PolygonHierarchy,
  PolylineDashMaterialProperty,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  ArcType,
  JulianDate,
  UrlTemplateImageryProvider,
  WebMercatorTilingScheme,
  VerticalOrigin,
  TileMapServiceImageryProvider,
  SingleTileImageryProvider,
  ArcGisMapServerImageryProvider,
  Ion,
  IonImageryProvider,
  createWorldTerrainAsync,
} from "cesium";
import type { ImageryLayer, ImageryProvider } from "cesium";
import type { Geometry, Position } from "geojson";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { useApp } from "@/lib/store";
import { phenomenonColor } from "@/lib/earth-vocabulary";
import { buildGeographicResults } from "@/lib/geographic-results";
import type { PlanetaryComputerVisualization } from "@/lib/planetary-computer";
import { nisarProductColor } from "@/lib/sar-registry";

const ION_TOKEN = import.meta.env["VITE_CESIUM_ION_TOKEN"] as string | undefined;
const ION_IMAGERY_ASSET_ID = Number(import.meta.env["VITE_CESIUM_ION_IMAGERY_ASSET_ID"] || 2);
const CUSTOM_IMAGERY_URL = import.meta.env["VITE_EARTH_IMAGERY_URL"] as string | undefined;
const CUSTOM_IMAGERY_ATTRIBUTION = import.meta.env["VITE_EARTH_IMAGERY_ATTRIBUTION"] as string | undefined;
const USE_ION_TERRAIN = String(import.meta.env["VITE_CESIUM_TERRAIN"] || "false").toLowerCase() === "true";

async function esriWorldImagery(): Promise<ImageryProvider> {
  // Use Cesium's native ArcGIS provider rather than constructing REST tile URLs by hand.
  return ArcGisMapServerImageryProvider.fromUrl(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
    { enablePickFeatures: false },
  );
}

function openStreetMapImagery(): ImageryProvider {
  return new UrlTemplateImageryProvider({
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    credit: "© OpenStreetMap contributors",
    minimumLevel: 0,
    maximumLevel: 19,
  });
}

function configuredImagery() {
  if (!CUSTOM_IMAGERY_URL) return null;
  return new UrlTemplateImageryProvider({
    url: CUSTOM_IMAGERY_URL,
    credit: CUSTOM_IMAGERY_ATTRIBUTION || "Configured imagery provider",
    maximumLevel: 22,
  });
}

function polygonCoordinates(geometry: Geometry | null): Position[][][] {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  if (geometry.type === "GeometryCollection") {
    return geometry.geometries.flatMap(polygonCoordinates);
  }
  return [];
}

function lineCoordinates(geometry: Geometry | null): Position[][] {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  if (geometry.type === "GeometryCollection") return geometry.geometries.flatMap(lineCoordinates);
  return [];
}

export default function EarthGlobe() {
  const container = useRef<HTMLDivElement>(null);
  const ref = useRef<Viewer | null>(null);
  const retryImageryRef = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const layers = useApp(s => s.layers);
  const filter = useApp(s => s.filter);
  const time = useApp(s => s.time);
  const aoi = useApp(s => s.aoi);
  const lod = useApp(s => s.lod);
  const selected = useApp(s => s.selectedId);
  const drawTool = useApp(s => s.drawTool);
  const drawingPoints = useApp(s => s.drawingPoints);
  const liveEvents = useApp(s => s.liveEvents);
  const nisarGranules = useApp(s => s.nisarGranules);
  const planetaryComputerResult = useApp(s => s.planetaryComputerResult);
  const agentFindings = useApp(s => s.agentFindings);
  const activeIntelligenceWorkflowId = useApp(s => s.activeIntelligenceWorkflowId);
  const planetaryVisualization = useApp(s => s.planetaryVisualization);
  const planetaryVisualizationEnabled = useApp(s => s.layers.has("selected-imagery"));
  const imageryOpacity = useApp(s => s.opacity["selected-imagery"] ?? 75);
  const scientificJob = useApp(s => s.scientificJob);
  const scientificJobPreviewUrl = useApp(s => s.scientificJobPreviewUrl);
  const scientificResultEnabled = useApp(s => s.layers.has("scientific-result"));
  const scientificResultOpacity = useApp(s => s.opacity["scientific-result"] ?? 75);
  const guestNISARMapResult = useApp(s => s.guestNISARMapResult);
  const guestNISARResultEnabled = useApp(s => s.layers.has("nisar-guest-result"));
  const guestNISARResultOpacity = useApp(s => s.opacity["nisar-guest-result"] ?? 75);
  const gpmIMERGEnabled = useApp(s => s.layers.has("gpm-imerg"));
  const gpmIMERGOpacity = useApp(s => s.opacity["gpm-imerg"] ?? 75);
  const nonce = useApp(s => s.viewNonce);
  const ds = useRef<CustomDataSource | null>(null);
  const planetaryImageryLayer = useRef<ImageryLayer | null>(null);
  const planetaryImageryKey = useRef<string | null>(null);
  const scientificImageryLayer = useRef<ImageryLayer | null>(null);
  const scientificImageryKey = useRef<string | null>(null);
  const guestNISARImageryLayer = useRef<ImageryLayer | null>(null);
  const guestNISARImageryKey = useRef<string | null>(null);
  const gpmIMERGImageryLayer = useRef<ImageryLayer | null>(null);

  useEffect(() => {
    if (!container.current) return;
    let cancelled = false;
    let fallbackBusy = false;
    let activeProvider: ImageryProvider | undefined;
    let activeLayer: ReturnType<Viewer["imageryLayers"]["addImageryProvider"]> | undefined;
    let offlineLayer: ImageryLayer | undefined;
    setReady(false);
    setError(null);
    const token = ION_TOKEN?.trim();
    if (token) Ion.defaultAccessToken = token;

    let viewer: Viewer;
    try {
      viewer = new Viewer(container.current, {
        baseLayer: false,
        terrainProvider: new EllipsoidTerrainProvider(),
        animation: false,
        timeline: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        // Normal rendering plus resize observation avoids stale first frames on mobile WebGL.
        requestRenderMode: false,
        maximumRenderTimeChange: Infinity,
      });
      viewer.resolutionScale = window.innerWidth < 760 ? 0.8 : 1;
    } catch (initializationError) {
      console.error("Cesium could not initialize WebGL.", initializationError);
      setError("The 3D Earth could not start in this browser. Try the 2D map or another browser with WebGL enabled.");
      return;
    }
    ref.current = viewer;

    const referenceLayers: Array<{ layer: ImageryLayer; minHeight: number; maxHeight: number }> = [];
    let referenceLayersPromise: Promise<void> | null = null;

    const updateReferenceLayers = () => {
      if (cancelled || viewer.isDestroyed()) return;
      const height = viewer.camera.positionCartographic.height;
      for (const reference of referenceLayers) {
        const alpha = Math.max(0, Math.min(1, (reference.maxHeight - height) / (reference.maxHeight - reference.minHeight)));
        reference.layer.show = alpha > 0.01;
        reference.layer.alpha = alpha;
      }
      if (referenceLayers.length) viewer.scene.requestRender();
    };

    // Transparent reference tiles fade in while zooming, keeping the 3D satellite globe
    // as the base view instead of switching to a separate 2D map.
    const installReferenceLayers = () => {
      if (referenceLayersPromise) return referenceLayersPromise;
      referenceLayersPromise = (async () => {
        const services = [
          {
            url: "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer",
            minHeight: 1_000_000,
            maxHeight: 10_000_000,
          },
          {
            url: "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer",
            minHeight: 250_000,
            maxHeight: 2_500_000,
          },
        ];
        const results = await Promise.allSettled(services.map((item) =>
          ArcGisMapServerImageryProvider.fromUrl(item.url, { enablePickFeatures: false }),
        ));
        if (cancelled || viewer.isDestroyed()) return;
        results.forEach((result, index) => {
          if (result.status !== "fulfilled") {
            console.warn("A transparent map-reference layer could not load.", result.reason);
            return;
          }
          const service = services[index];
          if (!service) return;
          const layer = viewer.imageryLayers.addImageryProvider(result.value);
          layer.alpha = 0;
          layer.show = false;
          referenceLayers.push({ layer, minHeight: service.minHeight, maxHeight: service.maxHeight });
        });
        updateReferenceLayers();
      })().catch((error) => {
        console.warn("Optional zoom-dependent map labels could not load.", error);
      });
      return referenceLayersPromise;
    };

    const removeActiveLayer = () => {
      if (activeLayer) viewer.imageryLayers.remove(activeLayer, true);
      activeLayer = undefined;
      activeProvider = undefined;
    };

    const installProvider = (
      provider: ImageryProvider,
      nextFallback: (() => void | Promise<void>) | null,
      notice: string | null = null,
    ) => {
      if (cancelled || viewer.isDestroyed()) return;
      removeActiveLayer();
      activeLayer = viewer.imageryLayers.addImageryProvider(provider);
      activeProvider = provider;
      setReady(true);
      setError(notice);
      viewer.scene.requestRender();
      void installReferenceLayers();
      provider.errorEvent.addEventListener((tileError) => {
        if (cancelled || viewer.isDestroyed() || activeProvider !== provider || fallbackBusy) return;
        if (tileError.timesRetried < 2) return;
        if (!nextFallback) {
          setError("Earth tiles are failing to load. Check your connection, retry, or switch to the 2D map.");
          return;
        }
        fallbackBusy = true;
        void Promise.resolve(nextFallback()).finally(() => { fallbackBusy = false; });
      });
    };

    const installNaturalEarthBase = async () => {
      if (cancelled || viewer.isDestroyed()) return false;
      if (offlineLayer) {
        setReady(true);
        return true;
      }
      try {
        const provider = await TileMapServiceImageryProvider.fromUrl("/cesium/Assets/Textures/NaturalEarthII");
        if (cancelled || viewer.isDestroyed()) return false;
        offlineLayer = viewer.imageryLayers.addImageryProvider(provider);
        setReady(true);
        setError(null);
        viewer.scene.requestRender();
        return true;
      } catch (fallbackError) {
        console.error("Bundled Earth fallback could not be loaded.", fallbackError);
        return false;
      }
    };

    const installNaturalEarthFallback = async () => {
      if (cancelled || viewer.isDestroyed()) return;
      removeActiveLayer();
      const installed = await installNaturalEarthBase();
      if (cancelled || viewer.isDestroyed()) return;
      if (!installed) {
        setReady(false);
        setError("No Earth imagery source could load. Check your connection, retry, or switch to the 2D map.");
        return;
      }
      setReady(true);
      setError("High-detail imagery could not load. Showing the bundled low-resolution Earth map.");
      viewer.scene.requestRender();
    };

    const installOSMFallback = (notice: string) => {
      installProvider(
        openStreetMapImagery(),
        () => installNaturalEarthFallback(),
        notice,
      );
    };

    const installEsriFallback = async (notice?: string) => {
      if (cancelled || viewer.isDestroyed()) return;
      try {
        const provider = await esriWorldImagery();
        installProvider(
          provider,
          () => installOSMFallback("Satellite tiles are unavailable on this connection. Switched to OpenStreetMap."),
          notice ?? null,
        );
      } catch (providerError) {
        console.warn("Esri imagery could not initialize; trying OpenStreetMap.", providerError);
        installOSMFallback("Satellite imagery could not initialize. Showing OpenStreetMap instead.");
      }
    };

    const installConfigured = (provider: ImageryProvider) => {
      installProvider(
        provider,
        () => installEsriFallback("The configured imagery source failed. Switched to Esri World Imagery."),
      );
    };

    const loadImagery = async () => {
      await installNaturalEarthBase();
      if (cancelled || viewer.isDestroyed()) return;
      const custom = configuredImagery();
      if (custom) {
        installConfigured(custom);
        return;
      }
      if (token) {
        try {
          const provider = await IonImageryProvider.fromAssetId(ION_IMAGERY_ASSET_ID);
          if (cancelled || viewer.isDestroyed()) return;
          installConfigured(provider);
          return;
        } catch (ionError) {
          console.warn("Cesium ion imagery unavailable; trying public imagery.", ionError);
        }
      }
      await installEsriFallback();
    };

    const retry = () => {
      if (cancelled || viewer.isDestroyed()) return;
      fallbackBusy = false;
      removeActiveLayer();
      setReady(false);
      setError(null);
      void loadImagery();
    };
    retryImageryRef.current = retry;
    void loadImagery();

    if (USE_ION_TERRAIN && token) {
      void createWorldTerrainAsync().then(terrain => {
        if (!cancelled && !viewer.isDestroyed()) {
          viewer.terrainProvider = terrain;
          viewer.scene.globe.depthTestAgainstTerrain = true;
          viewer.scene.requestRender();
        }
      }).catch(terrainError => {
        console.warn("Optional terrain is unavailable; retaining ellipsoid terrain.", terrainError);
      });
    }

    const source = new CustomDataSource("Third Eye live records");
    ds.current = source;
    source.clustering.clusterLabels = false;
    source.clustering.clusterBillboards = false;
    source.clustering.clusterPoints = true;
    source.clustering.clusterEvent.addEventListener((entities, cluster) => {
      cluster.billboard.show = false;
      cluster.label.show = true;
      cluster.label.text = entities.length.toLocaleString();
      cluster.label.font = "bold 12px IBM Plex Mono";
      cluster.label.fillColor = Color.WHITE;
      cluster.label.outlineColor = Color.fromCssColorString("#071017");
      cluster.label.outlineWidth = 2;
      cluster.label.showBackground = false;
      cluster.label.horizontalOrigin = HorizontalOrigin.CENTER;
      cluster.label.verticalOrigin = VerticalOrigin.CENTER;
      cluster.label.pixelOffset = Cartesian2.ZERO;
      cluster.point.show = true;
      cluster.point.pixelSize = entities.length >= 100 ? 38 : 32;
      cluster.point.color = Color.fromCssColorString("#103443").withAlpha(0.96);
      cluster.point.outlineColor = Color.fromCssColorString("#25D9FF");
      cluster.point.outlineWidth = 2;
    });
    void viewer.dataSources.add(source);
    viewer.scene.backgroundColor = Color.fromCssColorString(getComputedStyle(document.documentElement).getPropertyValue("--earth-space").trim() || "#050A0F");
    viewer.scene.globe.baseColor = Color.fromCssColorString("#182733");
    viewer.scene.globe.enableLighting = false;
    viewer.scene.globe.showGroundAtmosphere = false;
    viewer.scene.globe.depthTestAgainstTerrain = true;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
    if (viewer.scene.skyBox) viewer.scene.skyBox.show = false;
    if (viewer.scene.sun) viewer.scene.sun.show = false;
    if (viewer.scene.moon) viewer.scene.moon.show = false;
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 80;
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = 35000000;
    viewer.camera.percentageChanged = 0.01;
    const removeReferenceCameraChange = viewer.camera.changed.addEventListener(updateReferenceLayers);
    const view = useApp.getState().view;
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(
        view.lng,
        view.lat,
        view.altitude * Ellipsoid.WGS84.maximumRadius,
      ),
      // Set an explicit nadir orientation so the initial global view faces the Earth.
      orientation: {
        heading: CesiumMath.toRadians(0),
        pitch: CesiumMath.toRadians(-90),
        roll: 0,
      },
    });
    viewer.scene.requestRender();
    const resizeViewer = () => {
      if (!viewer.isDestroyed()) {
        viewer.resize();
        viewer.scene.requestRender();
      }
    };
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resizeViewer) : null;
    if (resizeObserver && container.current) resizeObserver.observe(container.current);
    const initialResizeFrame = window.requestAnimationFrame(resizeViewer);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") resizeViewer();
    };
    window.addEventListener("resize", resizeViewer);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const removeCamera = viewer.camera.moveEnd.addEventListener(() => {
      const pos = viewer.camera.positionCartographic;
      useApp.getState().syncView({ lat: CesiumMath.toDegrees(pos.latitude), lng: CesiumMath.toDegrees(pos.longitude), altitude: pos.height / Ellipsoid.WGS84.maximumRadius });
    });
    let lastInteraction = Date.now();
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((event: { position: Cartesian2 }) => {
      lastInteraction = Date.now();
      const state = useApp.getState();
      const position = viewer.camera.pickEllipsoid(event.position, viewer.scene.globe.ellipsoid);
      if (state.drawTool) {
        if (!position) return;
        const cartographic = Cartographic.fromCartesian(position, viewer.scene.globe.ellipsoid);
        state.addDrawingPoint([
          CesiumMath.toDegrees(cartographic.longitude),
          CesiumMath.toDegrees(cartographic.latitude),
        ]);
        return;
      }
      const picked = viewer.scene.pick(event.position);
      if (Array.isArray(picked?.id)) {
        void viewer.flyTo(picked.id, { duration: 0.8 }).catch(clusterError => {
          console.warn("Earth event cluster could not be expanded.", clusterError);
        });
        return;
      }
      const id = picked?.id?.properties?.eventId?.getValue(JulianDate.now());
      if (typeof id === "string") {
        useApp.getState().select(id);
        return;
      }
      if (picked?.id) return;
      if (!position) return;
      const cartographic = Cartographic.fromCartesian(position, viewer.scene.globe.ellipsoid);
      void useApp.getState().lookupLocation(
        CesiumMath.toDegrees(cartographic.latitude),
        CesiumMath.toDegrees(cartographic.longitude),
      );
    }, ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction((event: { endPosition: Cartesian2 }) => {
      if (useApp.getState().drawTool) {
        viewer.scene.canvas.style.cursor = "crosshair";
        return;
      }
      const picked = viewer.scene.pick(event.endPosition);
      const id = Array.isArray(picked?.id)
        ? null
        : picked?.id?.properties?.eventId?.getValue(JulianDate.now());
      useApp.getState().setHovered(typeof id === "string" ? id : null);
      viewer.scene.canvas.style.cursor = id || Array.isArray(picked?.id) ? "pointer" : "grab";
    }, ScreenSpaceEventType.MOUSE_MOVE);
    const markInteraction = () => { lastInteraction = Date.now(); };
    viewer.scene.canvas.addEventListener("pointerdown", markInteraction);
    viewer.scene.canvas.addEventListener("wheel", markInteraction);
    let previous = performance.now();
    const removeTick = viewer.clock.onTick.addEventListener(() => {
      const now = performance.now();
      const delta = Math.min((now - previous) / 1000, 0.1);
      previous = now;
      if (!useApp.getState().selectedId && Date.now() - lastInteraction > 12000 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) viewer.camera.rotateRight(delta * 0.003);
    });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      window.cancelAnimationFrame(initialResizeFrame);
      window.removeEventListener("resize", resizeViewer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      retryImageryRef.current = null;
      handler.destroy();
      removeCamera();
      removeReferenceCameraChange();
      removeTick();
      if (!viewer.isDestroyed()) {
        viewer.scene.canvas.removeEventListener("pointerdown", markInteraction);
        viewer.scene.canvas.removeEventListener("wheel", markInteraction);
        viewer.dataSources.remove(source, true);
        for (const reference of referenceLayers) viewer.imageryLayers.remove(reference.layer, true);
        viewer.destroy();
      }
      ref.current = null;
      ds.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = ref.current;
    if (!viewer || !ready) return;
    const view = useApp.getState().view;
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(
        view.lng,
        view.lat,
        view.altitude * Ellipsoid.WGS84.maximumRadius,
      ),
      orientation: {
        heading: CesiumMath.toRadians(0),
        pitch: CesiumMath.toRadians(-90),
        roll: 0,
      },
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1.6,
    });
  }, [nonce, ready]);

  useEffect(() => {
    const viewer = ref.current;
    if (!viewer || !ready) return;
    const visualization = planetaryVisualizationEnabled ? planetaryVisualization : null;
    const key = visualization?.itemId ?? null;
    if (planetaryImageryLayer.current && planetaryImageryKey.current !== key) {
      viewer.imageryLayers.remove(planetaryImageryLayer.current, true);
      planetaryImageryLayer.current = null;
      planetaryImageryKey.current = null;
    }
    if (!visualization) {
      viewer.scene.requestRender();
      return;
    }
    if (!planetaryImageryLayer.current) {
      const tileTemplate = visualization.tiles[0]
        ?.replace(/\{tileMatrix\}/g, "{z}")
        .replace(/\{tileCol\}/g, "{x}")
        .replace(/\{tileRow\}/g, "{y}");
      if (!tileTemplate) return;
      const provider = new UrlTemplateImageryProvider({
        url: tileTemplate,
        credit: visualization.attribution,
        rectangle: Rectangle.fromDegrees(...visualization.bounds),
        minimumLevel: visualization.minZoom ?? 0,
        maximumLevel: visualization.maxZoom ?? 22,
        enablePickFeatures: false,
      });
      planetaryImageryLayer.current = viewer.imageryLayers.addImageryProvider(provider);
      planetaryImageryKey.current = key;
    }
    planetaryImageryLayer.current.alpha = Math.max(0, Math.min(1, imageryOpacity / 100));
    planetaryImageryLayer.current.show = true;
    viewer.scene.requestRender();
  }, [ready, planetaryVisualization, planetaryVisualizationEnabled, imageryOpacity]);

  useEffect(() => {
    const viewer = ref.current;
    if (!viewer || !ready) return;
    let cancelled = false;
    const result = scientificResultEnabled && scientificJob?.status === "completed" ? scientificJob.result : null;
    const key = result && scientificJobPreviewUrl ? `${scientificJob.id}:${scientificJobPreviewUrl}` : null;
    if (scientificImageryLayer.current && scientificImageryKey.current !== key) {
      viewer.imageryLayers.remove(scientificImageryLayer.current, true);
      scientificImageryLayer.current = null;
      scientificImageryKey.current = null;
    }
    if (!result || !scientificJobPreviewUrl || !key) {
      viewer.scene.requestRender();
      return () => { cancelled = true; };
    }
    if (!scientificImageryLayer.current) {
      const rectangle = Rectangle.fromDegrees(...result.bounds);
      void SingleTileImageryProvider.fromUrl(scientificJobPreviewUrl, { rectangle }).then(provider => {
        if (cancelled || viewer.isDestroyed()) return;
        scientificImageryLayer.current = viewer.imageryLayers.addImageryProvider(provider);
        scientificImageryLayer.current.alpha = Math.max(0, Math.min(1, scientificResultOpacity / 100));
        scientificImageryLayer.current.show = true;
        scientificImageryKey.current = key;
        viewer.scene.requestRender();
      }).catch(error => {
        if (!cancelled) console.error("The processed Sentinel-2 map preview could not be loaded.", error);
      });
    } else {
      scientificImageryLayer.current.alpha = Math.max(0, Math.min(1, scientificResultOpacity / 100));
      scientificImageryLayer.current.show = true;
      viewer.scene.requestRender();
    }
    return () => { cancelled = true; };
  }, [ready, scientificJob, scientificJobPreviewUrl, scientificResultEnabled, scientificResultOpacity]);


  useEffect(() => {
    const viewer = ref.current;
    if (!viewer || !ready) return;
    let cancelled = false;
    const result = guestNISARResultEnabled ? guestNISARMapResult : null;
    const key = result ? result.jobId + ":" + result.previewUrl : null;
    if (guestNISARImageryLayer.current && guestNISARImageryKey.current !== key) {
      viewer.imageryLayers.remove(guestNISARImageryLayer.current, true);
      guestNISARImageryLayer.current = null;
      guestNISARImageryKey.current = null;
    }
    if (!result || !key) {
      viewer.scene.requestRender();
      return () => { cancelled = true; };
    }
    if (!guestNISARImageryLayer.current) {
      const rectangle = Rectangle.fromDegrees(...result.boundsWgs84);
      void SingleTileImageryProvider.fromUrl(result.previewUrl, { rectangle }).then(provider => {
        if (cancelled || viewer.isDestroyed()) return;
        guestNISARImageryLayer.current = viewer.imageryLayers.addImageryProvider(provider);
        guestNISARImageryLayer.current.alpha = Math.max(0, Math.min(1, guestNISARResultOpacity / 100));
        guestNISARImageryLayer.current.show = true;
        guestNISARImageryKey.current = key;
        viewer.scene.requestRender();
      }).catch(error => {
        if (!cancelled) console.error("The guest NISAR change preview could not be loaded.", error);
      });
    } else {
      guestNISARImageryLayer.current.alpha = Math.max(0, Math.min(1, guestNISARResultOpacity / 100));
      guestNISARImageryLayer.current.show = true;
      viewer.scene.requestRender();
    }
    return () => { cancelled = true; };
  }, [ready, guestNISARMapResult, guestNISARResultEnabled, guestNISARResultOpacity]);

  useEffect(() => {
    const viewer = ref.current;
    if (!viewer || !ready) return;
    if (!gpmIMERGEnabled) {
      if (gpmIMERGImageryLayer.current) {
        viewer.imageryLayers.remove(gpmIMERGImageryLayer.current, true);
        gpmIMERGImageryLayer.current = null;
      }
      viewer.scene.requestRender();
      return;
    }
    if (!gpmIMERGImageryLayer.current) {
      const provider = new UrlTemplateImageryProvider({
        url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/IMERG_Precipitation_Rate/default/default/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png",
        credit: "NASA GPM IMERG · NASA Global Imagery Browse Services (GIBS)",
        tilingScheme: new WebMercatorTilingScheme(),
        rectangle: Rectangle.fromDegrees(-180, -85.05112878, 180, 85.05112878),
        minimumLevel: 0,
        maximumLevel: 6,
        tileWidth: 256,
        tileHeight: 256,
        enablePickFeatures: false,
      });
      gpmIMERGImageryLayer.current = viewer.imageryLayers.addImageryProvider(provider);
    }
    gpmIMERGImageryLayer.current.alpha = Math.max(0, Math.min(1, gpmIMERGOpacity / 100));
    gpmIMERGImageryLayer.current.show = true;
    viewer.scene.requestRender();
  }, [ready, gpmIMERGEnabled, gpmIMERGOpacity]);

  useEffect(() => {
    const source = ds.current;
    if (!source || !ready) return;
    source.entities.removeAll();
    const css = getComputedStyle(document.documentElement);
    const system = Color.fromCssColorString(css.getPropertyValue("--earth-selection").trim() || "#25D9FF");
    source.clustering.enabled = lod === "global";
    source.clustering.pixelRange = 32;
    source.clustering.minimumClusterSize = 3;
    if (aoi) {
      polygonCoordinates(aoi.feature.geometry).forEach((polygon, index) => {
        const rings = polygon.map(ring => {
          const points = ring.length > 1 &&
            ring[0]?.[0] === ring[ring.length - 1]?.[0] &&
            ring[0]?.[1] === ring[ring.length - 1]?.[1]
            ? ring.slice(0, -1)
            : ring;
          return points.map(point => Cartesian3.fromDegrees(point[0]!, point[1]!));
        });
        const outer = rings[0];
        if (!outer?.length) return;
        source.entities.add({
          id: `current-aoi:${index}`,
          name: `${aoi.name} · current area of interest`,
          polygon: {
            hierarchy: new PolygonHierarchy(outer, rings.slice(1).map(hole => new PolygonHierarchy(hole))),
            material: system.withAlpha(0.035),
            height: 0,
            outline: false,
          },
        });
        rings.forEach((ring, ringIndex) => {
          if (ring.length < 2) return;
          source.entities.add({
            id: `current-aoi-boundary:${index}:${ringIndex}`,
            name: `${aoi.name} · area of interest boundary`,
            polyline: {
              positions: [...ring, ring[0]!],
              width: 1.2,
              material: new PolylineDashMaterialProperty({ color: system.withAlpha(0.78) }),
              clampToGround: true,
            },
          });
        });
      });
      if (aoi.feature.geometry.type === "Point") {
        const [lng, lat] = aoi.feature.geometry.coordinates;
        source.entities.add({
          id: "current-aoi-point",
          name: `${aoi.name} · current point of interest`,
          position: Cartesian3.fromDegrees(lng!, lat!),
          point: {
            pixelSize: 9,
            color: system,
            outlineColor: Color.WHITE,
            outlineWidth: 2,
            heightReference: HeightReference.CLAMP_TO_GROUND,
          },
        });
      }
    }
    if (drawingPoints.length) {
      const drawingPositions = drawingPoints.map(point => Cartesian3.fromDegrees(point[0]!, point[1]!));
      drawingPoints.forEach((point, index) => {
        source.entities.add({
          id: `aoi-drawing-point:${index}`,
          position: Cartesian3.fromDegrees(point[0]!, point[1]!),
          point: {
            pixelSize: 7,
            color: system,
            outlineColor: Color.WHITE,
            outlineWidth: 1.5,
            heightReference: HeightReference.CLAMP_TO_GROUND,
          },
        });
      });
      if (drawingPositions.length > 1) {
        source.entities.add({
          id: "aoi-drawing-line",
          polyline: {
            positions: drawingPositions,
            width: 2,
            material: new PolylineDashMaterialProperty({ color: system.withAlpha(0.9) }),
            arcType: ArcType.GEODESIC,
            clampToGround: true,
          },
        });
      }
    }
    const results = buildGeographicResults(useApp.getState());
    for (const result of results) {
      const chosen = result.id === selected;
      const eventColor = result.kind === "public-event" && result.sourceRecord && "source" in result.sourceRecord
        ? phenomenonColor(result.sourceRecord.type)
        : result.kind === "nisar-acquisition"
          ? nisarProductColor(String(result.metadata.productCode ?? ""))
          : result.kind === "satellite-observation"
            ? "#E9A66F"
            : "#25D9FF";
      const color = chosen ? system : Color.fromCssColorString(eventColor);
      const center = Cartesian3.fromDegrees(result.center.lng, result.center.lat, 0);
      const properties = {
        eventId: result.id,
        provider: result.provider,
        source: result.provider,
        sourceUrl: result.links[0]?.href ?? "",
        resultType: result.kind,
        dataClass: result.kind === "public-event"
          ? "public-event-context"
          : result.kind === "place"
            ? "place-context"
            : "catalog-observation",
      };
      source.entities.add({
        id: result.id,
        name: `${result.title} · ${result.provider} · ${result.kind.toUpperCase()}`,
        properties,
        position: center,
        point: {
          show: lod === "global" || polygonCoordinates(result.geometry).length === 0,
          pixelSize: chosen ? 11 : lod === "global" ? 8 : 7,
          color: color.withAlpha(0.94),
          outlineColor: Color.WHITE.withAlpha(chosen ? 1 : 0.85),
          outlineWidth: chosen ? 3 : 1.5,
          heightReference: HeightReference.CLAMP_TO_GROUND,
        },
      });
      const showGlobalFootprint = result.kind === "nisar-acquisition" &&
        result.metadata.extentType === "source-footprint";
      if (lod === "global" && !showGlobalFootprint) continue;
      polygonCoordinates(result.geometry).forEach((polygon, index) => {
        const rings = polygon.map((ring) => {
          const closed = ring.length > 1 &&
            ring[0]?.[0] === ring[ring.length - 1]?.[0] &&
            ring[0]?.[1] === ring[ring.length - 1]?.[1];
          const openRing = closed ? ring.slice(0, -1) : ring;
          return openRing.map((position) => Cartesian3.fromDegrees(position[0]!, position[1]!));
        });
        const outer = rings[0];
        if (!outer?.length) return;
        const isBounds = result.metadata.extentType === "bounding-box";
        if (!isBounds) {
          source.entities.add({
            id: `${result.id}:shape:${index}`,
            name: `${result.title} · source geometry`,
            properties,
            polygon: {
              hierarchy: new PolygonHierarchy(outer, rings.slice(1).map((hole) => new PolygonHierarchy(hole))),
              material: color.withAlpha(chosen ? 0.2 : lod === "global" ? 0.045 : 0.07),
              height: 0,
              outline: false,
            },
          });
        }
        polygon.forEach((ring, ringIndex) => {
          const positions = ring.map(point => Cartesian3.fromDegrees(point[0]!, point[1]!));
          if (positions.length < 2) return;
          source.entities.add({
            id: `${result.id}:boundary:${index}:${ringIndex}`,
            name: `${result.title} · ${isBounds ? "bounding box, not a source footprint" : "source geometry boundary"}`,
            properties,
            polyline: {
              positions,
              width: chosen ? 2.5 : lod === "global" ? 1.35 : 1.2,
              material: isBounds
                ? new PolylineDashMaterialProperty({ color: color.withAlpha(chosen ? 0.98 : 0.82) })
                : color.withAlpha(chosen ? 0.98 : lod === "global" ? 0.9 : 0.82),
              clampToGround: true,
            },
          });
        });
      });
      lineCoordinates(result.geometry).forEach((line, index) => {
        const positions = line.map(point => Cartesian3.fromDegrees(point[0]!, point[1]!));
        if (positions.length < 2) return;
        source.entities.add({
          id: `${result.id}:line:${index}`,
          name: `${result.title} · source geometry`,
          properties,
          polyline: {
            positions,
            width: chosen ? 3 : 1.5,
            material: color.withAlpha(chosen ? 0.98 : 0.85),
            arcType: ArcType.GEODESIC,
            clampToGround: true,
          },
        });
      });
    }
    const rankColors = ["#54D68A", "#25D9FF", "#FFB547", "#C2A8FF"];
    for (const finding of agentFindings) {
      const chosen = finding.id === selected;
      const color = Color.fromCssColorString(rankColors[finding.rank - 1] ?? "#C2A8FF");
      const properties = { eventId: finding.id, resultType: "agent-finding", dataClass: "ai-screening" };
      source.entities.add({
        id: finding.id,
        name: `#${finding.rank} ${finding.name} · AI screening finding`,
        properties,
        position: Cartesian3.fromDegrees(finding.longitude, finding.latitude, 0),
        point: {
          pixelSize: chosen ? 15 : 12,
          color: color.withAlpha(0.98),
          outlineColor: Color.WHITE,
          outlineWidth: chosen ? 3 : 2,
          heightReference: HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: String(finding.rank),
          font: "bold 12px IBM Plex Mono",
          fillColor: Color.fromCssColorString("#071017"),
          outlineColor: Color.WHITE,
          outlineWidth: 0,
          pixelOffset: new Cartesian2(0, -1),
          verticalOrigin: VerticalOrigin.CENTER,
          heightReference: HeightReference.CLAMP_TO_GROUND,
        },
      });
      polygonCoordinates(finding.geometry ?? null).forEach((polygon, index) => {
        const rings = polygon.map(ring => {
          const points = ring.length > 1 &&
            ring[0]?.[0] === ring[ring.length - 1]?.[0] &&
            ring[0]?.[1] === ring[ring.length - 1]?.[1]
            ? ring.slice(0, -1)
            : ring;
          return points.map(point => Cartesian3.fromDegrees(point[0]!, point[1]!));
        });
        const outer = rings[0];
        if (!outer?.length) return;
        source.entities.add({
          id: `${finding.id}:region:${index}`,
          name: `${finding.name} · approximate candidate region`,
          properties,
          polygon: {
            hierarchy: new PolygonHierarchy(outer, rings.slice(1).map(hole => new PolygonHierarchy(hole))),
            material: color.withAlpha(chosen ? 0.22 : 0.08),
            height: 0,
            outline: false,
          },
        });
        rings.forEach((ring, ringIndex) => {
          if (ring.length < 2) return;
          source.entities.add({
            id: `${finding.id}:region-boundary:${index}:${ringIndex}`,
            name: `${finding.name} · geocoded boundary`,
            properties,
            polyline: {
              positions: [...ring, ring[0]!],
              width: chosen ? 2.5 : 1.4,
              material: color.withAlpha(0.95),
              clampToGround: true,
            },
          });
        });
      });
    }
    ref.current?.scene.requestRender();
  }, [layers, filter, time, aoi, lod, selected, ready, liveEvents, nisarGranules, planetaryComputerResult, activeIntelligenceWorkflowId, drawingPoints, agentFindings]);

  useEffect(() => {
    const viewer = ref.current;
    if (viewer && !viewer.isDestroyed()) viewer.scene.canvas.style.cursor = drawTool ? "crosshair" : "grab";
  }, [drawTool]);

  return <div className="absolute inset-0 earth-renderer" data-earth-engine="cesium">
    <div ref={container} className="absolute inset-0" />
    {!ready && !error && <div className="earth-status label-xs" role="status">CONNECTING TO EARTH IMAGERY…</div>}
    {error && <div className="earth-status earth-status-action" role="status">
      <p>{error}</p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <button type="button" className="rounded border border-primary/50 px-3 py-1.5 text-[11px] text-primary hover:bg-primary/10" onClick={() => retryImageryRef.current ? retryImageryRef.current() : window.location.reload()}>RETRY IMAGERY</button>
        <button type="button" className="rounded border border-border px-3 py-1.5 text-[11px] hover:bg-elevated" onClick={() => useApp.getState().setEarthMode("2d")}>OPEN 2D MAP</button>
      </div>
    </div>}
  </div>;
}
