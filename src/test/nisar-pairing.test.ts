import { describe, expect, it } from "vitest";
import { discoverNISARPairs } from "../lib/nisar-pairing";
import type { NISARGranule } from "../lib/nasa-cmr";

function granule(id: string, date: string): NISARGranule {
  return {
    dataClass: "catalog-metadata", id, conceptId: id, granuleId: id,
    collectionConceptId: "C123-NISAR", collectionShortName: "NISAR_GCOV",
    productCode: "GCOV", maturity: "unknown", productionConfiguration: "unknown",
    orbitDirection: "A", polarization: "DHDH", trackNumber: "148", frameNumber: "008",
    productionTime: null, platform: null, instrument: null, title: id, startDate: date,
    endDate: null, producer: "NASA", bounds: null, footprint: null, browseUrl: null,
    dataUrl: null, metadataUrl: "https://cmr.earthdata.nasa.gov/", earthdataSearchUrl: "https://search.earthdata.nasa.gov/",
  };
}

describe("NISAR GCOV pair discovery", () => {
  it("suggests only full-coverage same-track pairs with matching processing metadata", () => {
    const base = "NISAR_L2_PR_GCOV_033_148_A_008_4005_DHDH_A_";
    const one = granule(base + "20261101T100000_20261101T100034_P05036_N_F_J_001.h5", "2026-11-01T10:00:00Z");
    const two = granule(base + "20261113T100000_20261113T100034_P05036_N_F_J_001.h5", "2026-11-13T10:00:00Z");
    const other = granule(base.replace("_148_", "_149_") + "20261125T100000_20261125T100034_P05036_N_F_J_001.h5", "2026-11-25T10:00:00Z");
    const pairs = discoverNISARPairs([one, two, other], "frequencyA", "HHHH");
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.before.conceptId).toBe(one.conceptId);
    expect(pairs[0]?.after.conceptId).toBe(two.conceptId);
  });
});
