import { describe, expect, it } from "vitest";
import type { Geometry } from "geojson";
import { rectangleAOI } from "../lib/analysis";
import {
  buildGeographicResults,
  geographicFeatureCollection,
  geographicPointFeatureCollection,
} from "../lib/geographic-results";
import type { GeographicResultInput } from "../lib/geographic-results";
import type { LiveEarthEvent } from "../lib/live-data";
import type { NISARGranule } from "../lib/nasa-cmr";
import { NISAR_COVERAGE_PRODUCT_CODES } from "../lib/sar-registry";

const locations = [
  { label: "Asia", lat: 35.68, lng: 139.69 },
  { label: "North America", lat: 34.05, lng: -118.24 },
  { label: "South America", lat: -23.55, lng: -46.63 },
  { label: "Europe", lat: 51.51, lng: -0.13 },
  { label: "Africa", lat: -1.29, lng: 36.82 },
  { label: "High latitude", lat: 78.22, lng: 15.65 },
];

function event(
  id: string,
  lat: number,
  lng: number,
  geometry: Geometry = { type: "Point", coordinates: [lng, lat] },
): LiveEarthEvent {
  return {
    id,
    sourceId: id,
    source: "NASA EONET",
    sourceLabel: "NASA EONET source report",
    sourceUrl: "https://eonet.gsfc.nasa.gov/",
    layerId: "live-eonet",
    type: "fire",
    title: id,
    region: "Source-reported event",
    country: "",
    lat,
    lng,
    geometry,
    date: "2026-10-10T00:00:00.000Z",
    metric: "OPEN",
    metricLabel: "source status",
    summary: "Source-reported event context.",
    dataClass: "public-event-context",
    pagerAlert: null,
    nisarURCandidate: false,
  };
}

function input(overrides: Partial<GeographicResultInput> = {}): GeographicResultInput {
  return {
    layers: new Set(["live-eonet"]),
    time: { start: "2026-10-01", end: "2026-10-31", current: "2026-10-31" },
    aoi: null,
    liveEvents: [],
    nisarGranules: [],
    planetaryComputerResult: null,
    activeIntelligenceWorkflowId: "wildfire-monitoring",
    selectedId: null,
    locationResult: null,
    mode: "intelligence",
    filter: { types: null, region: null },
    ...overrides,
  };
}

describe("normalized geographic results", () => {
  it("filters source event geometry by AOI across six regions, including high latitudes", () => {
    const records = locations.map((location, index) => event(`eonet-${index}`, location.lat, location.lng));
    for (const [index, location] of locations.entries()) {
      const aoi = rectangleAOI(
        [location.lng - 0.5, location.lat - 0.5],
        [location.lng + 0.5, location.lat + 0.5],
      );
      const results = buildGeographicResults(input({ liveEvents: records, aoi }));
      expect(results.map(result => result.id), location.label).toEqual([`eonet-${index}`]);
      expect(results[0]?.geometry?.type).toBe("Point");
    }
  });

  it("shows enabled source events outside the active analysis workflow", () => {
    const earthquake: LiveEarthEvent = {
      ...event("usgs-earthquake", 19.1, 72.8),
      source: "USGS",
      sourceLabel: "USGS Earthquake Catalog (M5+)",
      sourceUrl: "https://earthquake.usgs.gov/",
      layerId: "live-usgs",
      type: "earthquake",
      metric: "M 5.2",
      metricLabel: "reported earthquake magnitude",
    };

    const results = buildGeographicResults(input({
      layers: new Set(["live-usgs"]),
      liveEvents: [earthquake],
    }));

    expect(results.map(result => result.id)).toEqual(["usgs-earthquake"]);
    expect(geographicPointFeatureCollection(results, null, "live-usgs").features[0]?.geometry)
      .toEqual({ type: "Point", coordinates: [72.8, 19.1] });
  });

  it("maps NISAR catalog records only when both the coverage and product layers are enabled", () => {
    const granule: NISARGranule = {
      dataClass: "catalog-metadata",
      id: "nisar:G123-ASF",
      conceptId: "G123-ASF",
      granuleId: "NISAR_GCOV_TEST",
      collectionConceptId: "C123-ASF",
      collectionShortName: "NISAR_L2_GCOV_V1",
      productCode: "GCOV",
      maturity: "validated",
      productionConfiguration: "standard",
      orbitDirection: null,
      polarization: null,
      trackNumber: null,
      frameNumber: null,
      productionTime: null,
      platform: "NISAR",
      instrument: null,
      title: "NISAR GCOV test record",
      startDate: "2026-10-10T00:00:00Z",
      endDate: null,
      producer: "NASA",
      bounds: { west: 70, south: 19, east: 72, north: 21 },
      footprint: null,
      browseUrl: null,
      dataUrl: null,
      metadataUrl: "https://cmr.earthdata.nasa.gov/search/concepts/G123-ASF.umm_json",
      earthdataSearchUrl: "https://search.earthdata.nasa.gov/",
    };
    const layers = new Set(["nisar-coverage", "prod-GCOV"]);
    const results = buildGeographicResults(input({ layers, nisarGranules: [granule] }));

    expect(geographicPointFeatureCollection(results, null, "nisar-coverage").features[0]?.geometry)
      .toEqual({ type: "Point", coordinates: [71, 20] });
    const bboxFeature = geographicFeatureCollection(results, null, "nisar-coverage").features[0];
    expect(bboxFeature?.properties.extentType).toBe("bounding-box");
    expect(bboxFeature?.properties.color).toBe("#32C7E8");
    const footprintResults = buildGeographicResults(input({
      layers,
      nisarGranules: [{ ...granule, footprint: [[70, 19], [72, 19], [72, 21]] }],
    }));
    expect(geographicFeatureCollection(footprintResults, null, "nisar-coverage").features[0]?.properties.extentType)
      .toBe("source-footprint");
    expect(buildGeographicResults(input({
      layers: new Set(["nisar-coverage"]),
      nisarGranules: [granule],
    }))).toEqual([]);
  });

  it("maps every supported NISAR coverage product family independently", () => {
    const granules = NISAR_COVERAGE_PRODUCT_CODES.map((productCode, index): NISARGranule => ({
      dataClass: "catalog-metadata",
      id: `nisar:${productCode}`,
      conceptId: `G-${productCode}`,
      granuleId: `NISAR_${productCode}_TEST`,
      collectionConceptId: `C-${productCode}`,
      collectionShortName: `NISAR_${productCode}_V1`,
      productCode,
      maturity: "validated",
      productionConfiguration: "standard",
      orbitDirection: null,
      polarization: null,
      trackNumber: null,
      frameNumber: null,
      productionTime: null,
      platform: "NISAR",
      instrument: "L-SAR",
      title: `NISAR ${productCode}`,
      startDate: "2026-10-10T00:00:00Z",
      endDate: null,
      producer: "NASA",
      bounds: { west: index, south: 10, east: index + 0.5, north: 10.5 },
      footprint: null,
      browseUrl: null,
      dataUrl: null,
      metadataUrl: `https://cmr.earthdata.nasa.gov/search/concepts/G-${productCode}.umm_json`,
      earthdataSearchUrl: "https://search.earthdata.nasa.gov/",
    }));
    const layers = new Set([
      "nisar-coverage",
      ...NISAR_COVERAGE_PRODUCT_CODES.map(code => `prod-${code}`),
    ]);

    const results = buildGeographicResults(input({ layers, nisarGranules: granules }));
    const features = geographicFeatureCollection(results, null, "nisar-coverage").features;

    expect(results).toHaveLength(NISAR_COVERAGE_PRODUCT_CODES.length);
    expect(new Set(features.map(feature => feature?.properties.color)).size)
      .toBe(NISAR_COVERAGE_PRODUCT_CODES.length);
    expect(features.every(feature => Boolean(feature?.geometry))).toBe(true);
  });

  it("keeps reported polygon geometry and makes map features select the source record", () => {
    const polygon: Geometry = {
      type: "Polygon",
      coordinates: [[[70, 20], [72, 20], [72, 22], [70, 22], [70, 20]]],
    };
    const source = event("eonet-polygon", 20.8, 70.8, polygon);
    const results = buildGeographicResults(input({ liveEvents: [source] }));
    const feature = geographicFeatureCollection(results, source.id, "live-eonet").features[0];

    expect(results[0]?.geometry).toEqual(polygon);
    expect(results[0]?.bounds).toEqual([70, 20, 72, 22]);
    expect(feature?.properties.selected).toBe(true);
    expect(feature?.geometry).toEqual(polygon);
  });

  it("uses a STAC bounding box as a mapped footprint when source geometry is absent", () => {
    const result = buildGeographicResults(input({
      layers: new Set(["planetary-observations"]),
      planetaryComputerResult: {
        source: "Microsoft Planetary Computer STAC",
        dataClass: "catalog-metadata",
        workflowId: "wildfire-monitoring",
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        matched: 1,
        warnings: [],
        fetchedAt: "2026-10-31T00:00:00.000Z",
        items: [{
          id: "pc:modis-14A1-061:item-1",
          collectionId: "modis-14A1-061",
          collectionLabel: "MODIS active fires",
          title: "Catalog observation",
          datetime: "2026-10-10T00:00:00.000Z",
          platform: "Terra",
          instruments: ["MODIS"],
          bbox: [-121, 33, -120, 34],
          geometry: null,
          itemUrl: "https://planetarycomputer.microsoft.com/item",
          previewUrl: null,
          dataClass: "catalog-observation",
        }],
      },
    }));

    expect(result).toHaveLength(1);
    expect(result[0]?.geometry).toMatchObject({
      type: "Polygon",
      coordinates: [[[-121, 33], [-120, 33], [-120, 34], [-121, 34], [-121, 33]]],
    });
  });
});
