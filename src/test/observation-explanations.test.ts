import { describe, expect, it } from "vitest";
import { getNISARObservationExplanation } from "../lib/observation-explanations";

describe("NISAR observation explanations", () => {
  it("explains GSLC in plain language and keeps the provisional caveat", () => {
    const explanation = getNISARObservationExplanation("GSLC", "provisional");

    expect(explanation.label).toBe("Map-aligned radar data");
    expect(explanation.explanation).toContain("not a normal photograph");
    expect(explanation.explanation).toContain("NASA marks this collection provisional.");
    expect(explanation.explanation).not.toContain("single-look complex");
    expect(explanation.applications).toContain("Comparing observations to research changes at the surface");
  });

  it("gives GCOV a distinct, source-safe explanation", () => {
    const explanation = getNISARObservationExplanation("GCOV", "validated");

    expect(explanation.explanation).toContain("radar signals bounced back");
    expect(explanation.explanation).toContain("does not confirm a flood");
    expect(explanation.explanation).not.toContain("NASA marks this collection provisional.");
  });
});
