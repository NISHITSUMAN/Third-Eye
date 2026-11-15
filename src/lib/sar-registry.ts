export type NISARMaturity = "validated" | "provisional" | "beta" | "unknown";
export type NISARProductionConfiguration = "standard" | "urgent-response" | "unknown";

export const NISAR_PRODUCT_SOURCE = "https://nisar-docs.asf.alaska.edu/products-overview/";

export type NISARProductDefinition = {
  code: string;
  level: "L0B" | "L1" | "L2" | "L3";
  name: string;
  description: string;
  coverageSearch: boolean;
};

export const NISAR_PRODUCTS = [
  { code: "RRSD", level: "L0B", name: "Raw Science Data", description: "Raw radar science data in instrument coordinates.", coverageSearch: true },
  { code: "CRSD", level: "L0B", name: "Raw Calibration Data", description: "Raw calibration data used to characterize the instrument.", coverageSearch: true },
  { code: "RSLC", level: "L1", name: "Range-Doppler Single-Look Complex", description: "Single-look complex data in radar coordinates.", coverageSearch: true },
  { code: "RIFG", level: "L1", name: "Range-Doppler Interferogram", description: "Interferogram data in radar coordinates.", coverageSearch: true },
  { code: "ROFF", level: "L1", name: "Range-Doppler Pixel Offsets", description: "Pixel-offset data in radar coordinates.", coverageSearch: true },
  { code: "RUNW", level: "L1", name: "Range-Doppler Unwrapped Interferogram", description: "Unwrapped interferogram data in radar coordinates.", coverageSearch: true },
  { code: "GSLC", level: "L2", name: "Geocoded Single-Look Complex", description: "Geocoded single-look complex data.", coverageSearch: true },
  { code: "GCOV", level: "L2", name: "Geocoded Covariance", description: "Geocoded polarimetric covariance data.", coverageSearch: true },
  { code: "GUNW", level: "L2", name: "Geocoded Unwrapped Interferogram", description: "Geocoded unwrapped interferogram data.", coverageSearch: true },
  { code: "GOFF", level: "L2", name: "Geocoded Pixel Offsets", description: "Geocoded pixel-offset data.", coverageSearch: true },
  { code: "SME2", level: "L3", name: "Soil Moisture", description: "Level 3 soil-moisture product.", coverageSearch: true },
] as const satisfies readonly NISARProductDefinition[];

export type NISARProductCode = (typeof NISAR_PRODUCTS)[number]["code"];
export type NISARCoverageProductCode = Extract<
  (typeof NISAR_PRODUCTS)[number],
  { coverageSearch: true }
>["code"];

const NISAR_PRODUCT_COLORS: Record<NISARProductCode, string> = {
  RRSD: "#7D9CAB",
  CRSD: "#C2D3DD",
  RSLC: "#6BA6FF",
  RIFG: "#D47BCC",
  ROFF: "#9CCB4A",
  RUNW: "#F29B57",
  GSLC: "#B8A0FF",
  GCOV: "#32C7E8",
  GUNW: "#F07178",
  GOFF: "#5CC8A1",
  SME2: "#E5C454",
};

export function nisarProductColor(productCode: string): string {
  const product = NISAR_PRODUCTS.find((item) => item.code === productCode);
  return product ? NISAR_PRODUCT_COLORS[product.code] : "#2EC4FF";
}

export const NISAR_COVERAGE_PRODUCT_CODES: NISARCoverageProductCode[] =
  NISAR_PRODUCTS.filter((product) => product.coverageSearch).map((product) => product.code);

export const DEFAULT_NISAR_PRODUCTS: NISARCoverageProductCode[] = [
  "RRSD",
  "CRSD",
  "RSLC",
  "RIFG",
  "ROFF",
  "RUNW",
  "GSLC",
  "GCOV",
  "GUNW",
  "GOFF",
  "SME2",
];

export function isNISARCoverageProductCode(value: string): value is NISARCoverageProductCode {
  return NISAR_COVERAGE_PRODUCT_CODES.some((code) => code === value);
}

const MATURITY_PRIORITY: Record<NISARMaturity, number> = {
  validated: 3,
  provisional: 2,
  beta: 1,
  unknown: 0,
};

export function inferNISARMaturity(collectionShortName: string): NISARMaturity {
  const tokens = collectionShortName.toUpperCase().split(/[^A-Z0-9]+/);
  if (tokens.includes("VALIDATED")) return "validated";
  if (tokens.includes("PROVISIONAL")) return "provisional";
  if (tokens.includes("BETA")) return "beta";
  if (tokens.includes("UR") || tokens.includes("URGENT") || tokens.includes("URGENTRESPONSE")) return "unknown";
  const product = NISAR_PRODUCTS.find((item) => tokens.includes(item.code));
  if (
    tokens[0] === "NISAR" &&
    tokens.includes("V1") &&
    product &&
    product.level !== "L3"
  ) return "validated";
  return "unknown";
}

export function inferNISARProductionConfiguration(...values: string[]): NISARProductionConfiguration {
  const text = values.join(" ").toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  if (/\bURGENT_RESPONSE\b|(?:^|_)UR(?:_|$)/.test(text)) return "urgent-response";
  if (/\bSTANDARD\b|(?:^|_)STANDARD(?:_|$)/.test(text)) return "standard";
  return "unknown";
}

export function compareNISARMaturity(a: NISARMaturity, b: NISARMaturity): number {
  return MATURITY_PRIORITY[b] - MATURITY_PRIORITY[a];
}

export function extractNISARProductCode(value: string): NISARProductCode | null {
  const tokens = value.toUpperCase().split(/[^A-Z0-9]+/);
  return NISAR_PRODUCTS.find((product) => tokens.includes(product.code))?.code ?? null;
}

export type SARMissionDefinition = {
  id: "nisar" | "sentinel-1" | "radarsat-1" | "rcm";
  name: string;
  sensor: string;
  integration: "live-metadata" | "not-integrated";
  provider: string;
  accessSummary: string;
  sourceUrl: string;
};

export const SAR_MISSIONS = [
  {
    id: "nisar",
    name: "NISAR",
    sensor: "NASA-ISRO L-band and S-band SAR",
    integration: "live-metadata",
    provider: "NASA CMR",
    accessSummary: "CMR collection and granule metadata are searchable. ASF raster downloads require a free Earthdata Login; this app does not download them.",
    sourceUrl: "https://science.nasa.gov/mission/nisar/mission-overview/",
  },
  {
    id: "sentinel-1",
    name: "Sentinel-1",
    sensor: "C-band SAR",
    integration: "not-integrated",
    provider: "ASF DAAC Search API",
    accessSummary: "ASF documents Sentinel-1 metadata search. This app has no Sentinel-1 catalog or data-access integration.",
    sourceUrl: "https://docs.asf.alaska.edu/datasets/using_ASF_data/#sentinel-1",
  },
  {
    id: "radarsat-1",
    name: "RADARSAT-1",
    sensor: "C-band SAR",
    integration: "not-integrated",
    provider: "CSA EODMS / AWS",
    accessSummary: "CSA describes a free archive through EODMS and AWS. Account requirements were not verified; archive completeness can change as holdings are repatriated.",
    sourceUrl: "https://www.asc-csa.gc.ca/eng/satellites/radarsat1/data-access.asp",
  },
  {
    id: "rcm",
    name: "RADARSAT Constellation Mission",
    sensor: "C-band SAR",
    integration: "not-integrated",
    provider: "CSA EODMS",
    accessSummary: "Public access requires EODMS registration and is product-limited; additional access is vetted. Product-specific licence terms apply.",
    sourceUrl: "https://www.asc-csa.gc.ca/eng/satellites/radarsat/access-to-data/about.asp",
  },
] as const satisfies readonly SARMissionDefinition[];
