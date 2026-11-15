import { describe, expect, it } from "vitest";
import { parseNISARProductCodes } from "../routes/api.nisar.coverage";
import { NISAR_COVERAGE_PRODUCT_CODES } from "../lib/sar-registry";

describe("NISAR coverage product selection", () => {
  it("accepts every supported product family in one search", () => {
    expect(parseNISARProductCodes(NISAR_COVERAGE_PRODUCT_CODES.join(",")))
      .toEqual(NISAR_COVERAGE_PRODUCT_CODES);
  });

  it("deduplicates product codes and ignores unsupported families", () => {
    expect(parseNISARProductCodes("gcov,GSLC,GCOV,RRSD,CRSD,unknown"))
      .toEqual(["GCOV", "GSLC", "RRSD", "CRSD"]);
  });
});
