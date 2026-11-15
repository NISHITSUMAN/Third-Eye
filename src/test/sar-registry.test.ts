import { describe, expect, it } from "vitest";
import {
  compareNISARMaturity,
  DEFAULT_NISAR_PRODUCTS,
  extractNISARProductCode,
  inferNISARProductionConfiguration,
  inferNISARMaturity,
  NISAR_COVERAGE_PRODUCT_CODES,
  NISAR_PRODUCTS,
  SAR_MISSIONS,
} from "../lib/sar-registry";

describe("SAR mission and product registry", () => {
  it("keeps product codes unique and makes every registered family searchable", () => {
    const codes = NISAR_PRODUCTS.map((product) => product.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(NISAR_COVERAGE_PRODUCT_CODES).toHaveLength(11);
    expect(NISAR_PRODUCTS.filter((product) => !product.coverageSearch)).toEqual([]);
    expect(DEFAULT_NISAR_PRODUCTS).toEqual(NISAR_COVERAGE_PRODUCT_CODES);
  });

  it("extracts product codes as identifier tokens and leaves unrelated text unknown", () => {
    expect(extractNISARProductCode("NISAR_L2_GCOV_VALIDATED_V1")).toBe("GCOV");
    expect(extractNISARProductCode("NISAR_L0B_RRSD_BETA_V1")).toBe("RRSD");
    expect(extractNISARProductCode("NISAR_L2_GCOVARIANCE_V1")).toBeNull();
  });

  it("recognizes source-reported maturity tokens and prefers validated records", () => {
    expect(inferNISARMaturity("NISAR_L2_GCOV_VALIDATED_V1")).toBe("validated");
    expect(inferNISARMaturity("NISAR_L2_GCOV_PROVISIONAL_V1")).toBe("provisional");
    expect(inferNISARMaturity("NISAR_L2_GCOV_BETA_V1")).toBe("beta");
    expect(inferNISARMaturity("NISAR_L2_GCOV_V1")).toBe("validated");
    expect(inferNISARMaturity("NISAR_L3_SME2_V1")).toBe("unknown");
    expect(inferNISARMaturity("OTHER_L2_GCOV_V1")).toBe("unknown");
    expect(inferNISARMaturity("NISAR_L2_GCOV_V2")).toBe("unknown");
    expect(inferNISARMaturity("NISAR_L1_UR_RSLC_V1")).toBe("unknown");
    expect(inferNISARProductionConfiguration("NISAR_L1_UR_RSLC_V1")).toBe("urgent-response");
    expect(inferNISARProductionConfiguration("PRODUCTION_CONFIGURATION: STANDARD")).toBe("standard");
    expect(compareNISARMaturity("validated", "provisional")).toBeLessThan(0);
    expect(compareNISARMaturity("provisional", "beta")).toBeLessThan(0);
  });

  it("marks only NISAR metadata as integrated and keeps other missions explicitly unconfigured", () => {
    expect(SAR_MISSIONS.filter((mission) => mission.integration === "live-metadata").map((mission) => mission.id))
      .toEqual(["nisar"]);
    expect(SAR_MISSIONS.filter((mission) => mission.integration === "not-integrated").map((mission) => mission.id))
      .toEqual(["sentinel-1", "radarsat-1", "rcm"]);
    expect(SAR_MISSIONS.every((mission) => mission.sourceUrl.startsWith("https://"))).toBe(true);
  });
});
