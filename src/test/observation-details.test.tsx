import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ObservationDetails } from "../components/te/ObservationDetails";

describe("observation details", () => {
  it("shows the selected-record AI reading and its metadata-only scope", () => {
    render(
      <ObservationDetails
        title="Satellite observation over 19.50° N, 72.00° E"
        subtitle="NISAR GCOV"
        kindLabel="NISAR ACQUISITION · NASA CMR"
        dataClass="Processed NISAR product · L2"
        source="NASA CMR / ASF"
        sourceUrl="https://example.org/record"
        countryRegion={null}
        coordinates={{ lat: 19.5, lng: 72, approximate: true }}
        timeline={[]}
        aiExplanation={{
          status: "ready",
          explanation: "NASA CMR lists a geocoded radar product at this location.",
          error: null,
          relatedRecordCount: 2,
          relatedRecordsAnalyzed: 2,
          relatedRecords: [{
            id: "older-gcov",
            kind: "NISAR catalog record",
            source: "NASA CMR / ASF",
            title: "Earlier GCOV acquisition",
            product: "GCOV",
            date: "2026-09-10T00:00:00Z",
          }, {
            id: "older-gslc",
            kind: "NISAR catalog record",
            source: "NASA CMR / ASF",
            title: "Earlier GSLC acquisition",
            product: "GSLC",
            date: "2026-08-10T00:00:00Z",
          }],
          retry: vi.fn(),
        }}
        explanation="Static product guide."
        applications={[]}
        technicalMetadata={{ granuleId: "NISAR_GCOV_RECORD" }}
        integrityNote="CATALOG RECORD ONLY"
        close={vi.fn()}
      />,
    );

    expect(screen.getByText("NASA CMR lists a geocoded radar product at this location.")).toBeVisible();
    expect(screen.getByText(/2 loaded records with overlapping reported bounds/)).toBeVisible();
    expect(screen.getByText("AI OVERVIEW · SELECTED + RELATED DATA")).toBeVisible();
    expect(screen.getByText("RELATED RECORDS SENT TO AI")).toBeVisible();
    expect(screen.getByText("Earlier GCOV acquisition")).toBeVisible();
    expect(screen.getByText("Earlier GCOV acquisition").parentElement?.textContent).toContain("NASA CMR / ASF");
    expect(screen.queryByText("Static product guide.")).not.toBeInTheDocument();
  });

  it("shows a human-readable overview first and reveals provider metadata on request", () => {
    render(
      <ObservationDetails
        title="Satellite observation over 19.50° N, 72.00° E"
        subtitle="NISAR GCOV"
        kindLabel="NISAR ACQUISITION · NASA CMR"
        dataClass="Processed NISAR product · L2"
        source="NASA CMR / ASF"
        sourceUrl="https://example.org/record"
        countryRegion={null}
        coordinates={{ lat: 19.5, lng: 72, approximate: true }}
        timeline={[{ label: "Acquisition start", value: "Oct 1, 2026" }]}
        explanation="A catalog record for geocoded radar backscatter data."
        applications={["Backscatter research"]}
        technicalMetadata={{
          "Normalized catalog fields": { granuleId: "NISAR_GCOV_RECORD" },
          "NASA CMR source record": {
            umm: {
              Platform: "NISAR",
              AdditionalAttributes: [{ Name: "polarization", Values: ["HH", "HV"] }],
            },
          },
        }}
        integrityNote="CATALOG RECORD ONLY"
        close={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: /Satellite observation over/ })).toBeVisible();
    expect(screen.getByText("A catalog record for geocoded radar backscatter data.")).toBeVisible();
    expect(screen.queryByText("NISAR_GCOV_RECORD")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Check Metadata/ }));

    expect(screen.getByText("NISAR_GCOV_RECORD")).toBeVisible();
    expect(screen.getByText("Platform")).toBeVisible();
    expect(screen.getByText("NISAR")).toBeVisible();
    expect(screen.getByText("HH")).toBeVisible();
    expect(screen.getByText("HV")).toBeVisible();
  });
});
