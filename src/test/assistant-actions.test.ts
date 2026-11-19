import { describe, expect, it } from "vitest";
import { validateAssistantAction } from "../lib/assistant-actions";

describe("assistant application action validation", () => {
  it("accepts the named NISAR surface-change analysis request", () => {
    expect(validateAssistantAction({
      type: "run_nisar_gcov_change",
      beforeRecordId: "before-granule",
      afterRecordId: "after-granule",
      frequency: "frequencyA",
      polarizationTerm: "HHHH",
    }, "Analyze NISAR surface change")).toEqual({
      type: "run_nisar_gcov_change",
      beforeRecordId: "before-granule",
      afterRecordId: "after-granule",
      frequency: "frequencyA",
      polarizationTerm: "HHHH",
    });
  });

  it("accepts navigation only to an explicitly supplied coordinate pair", () => {
    expect(validateAssistantAction({ type: "fly_to", lat: 34.4, lng: 76.2 }, "Go to 34.4, 76.2")).toEqual({
      type: "fly_to",
      lat: 34.4,
      lng: 76.2,
      altitude: 0.4,
    });
    expect(validateAssistantAction({ type: "fly_to", lat: 34.4, lng: 76.2 }, "Show me Kashmir")).toBeNull();
    expect(validateAssistantAction({ type: "fly_to", lat: 34.4, lng: 76.2 }, "Go to 34.4, 76.3")).toBeNull();
  });

  it("rejects out-of-range coordinates and altitude", () => {
    expect(validateAssistantAction({ type: "fly_to", lat: 91, lng: 10 }, "91, 10")).toBeNull();
    expect(validateAssistantAction({ type: "fly_to", lat: 10, lng: 10, altitude: 6 }, "10, 10")).toBeNull();
  });

  it("validates real calendar dates and ordered ranges", () => {
    expect(validateAssistantAction({ type: "set_time_range", start: "2024-02-29", end: "2024-03-01" }, "")).toEqual({
      type: "set_time_range",
      start: "2024-02-29",
      end: "2024-03-01",
    });
    expect(validateAssistantAction({ type: "set_time_range", start: "2025-02-29", end: "2025-03-01" }, "")).toBeNull();
    expect(validateAssistantAction({ type: "set_time_range", start: "2025-03-02", end: "2025-03-01" }, "")).toBeNull();
  });

  it("rejects actions outside the application allowlist", () => {
    expect(validateAssistantAction({ type: "set_layer", layer: "simulated-flood", enabled: true }, "")).toBeNull();
    expect(validateAssistantAction({ type: "navigate", route: "https://example.com" }, "")).toBeNull();
    expect(validateAssistantAction({ type: "switch_earth_view", view: "satellite" }, "")).toBeNull();
  });

  it("validates place resolution against the user's words", () => {
    expect(validateAssistantAction({
      type: "search_location",
      locationQuery: "Nepal",
    }, "Show me Nepal on the globe")).toEqual({
      type: "search_location",
      locationQuery: "Nepal",
    });
    expect(validateAssistantAction({
      type: "search_location",
      locationQuery: "Nepal",
    }, "Show me Bhutan on the globe")).toBeNull();
  });

  it("allows weather requests at the current area or an explicitly named place", () => {
    expect(validateAssistantAction({ type: "get_weather_context" }, "Check weather here")).toEqual({
      type: "get_weather_context",
    });
    expect(validateAssistantAction({
      type: "get_weather_context",
      locationQuery: "Nairobi",
    }, "Check weather near Nairobi")).toEqual({
      type: "get_weather_context",
      locationQuery: "Nairobi",
    });
    expect(validateAssistantAction({
      type: "get_weather_context",
      locationQuery: "Nairobi",
    }, "Check weather near Mombasa")).toBeNull();
  });

  it("allows climate profiles for the selected area or a bounded unique candidate set", () => {
    expect(validateAssistantAction(
      { type: "get_climate_context" },
      "What can I grow in this selected area?",
    )).toEqual({ type: "get_climate_context" });
    expect(validateAssistantAction(
      { type: "get_climate_context", locationQueries: ["Shimla", "Mahabaleshwar", "Ooty"] },
      "Compare candidate regions for strawberries",
    )).toEqual({
      type: "get_climate_context",
      locationQueries: ["Shimla", "Mahabaleshwar", "Ooty"],
    });
    expect(validateAssistantAction(
      { type: "get_climate_context", locationQueries: ["Shimla", "Shimla"] },
      "Compare candidate regions",
    )).toBeNull();
    expect(validateAssistantAction(
      { type: "get_climate_context", locationQueries: ["Shimla", "Ooty", "Pune", "Jaipur", "Mysuru", "Kochi"] },
      "Compare candidate regions",
    )).toBeNull();
    expect(validateAssistantAction(
      { type: "get_climate_context", locationQuery: "Shimla", locationQueries: ["Ooty", "Pune"] },
      "Compare candidate regions",
    )).toBeNull();
  });

  it("only accepts explicit focus requests for bounded record IDs", () => {
    expect(validateAssistantAction({
      type: "select_result",
      recordId: "pc:item:123",
    }, "Focus the latest currently loaded observation on the map")).toEqual({
      type: "select_result",
      recordId: "pc:item:123",
    });
    expect(validateAssistantAction({
      type: "select_result",
      recordId: "pc:item:123",
    }, "Explain the latest observation")).toBeNull();
    expect(validateAssistantAction({
      type: "select_result",
      recordId: "x".repeat(201),
    }, "Focus that observation")).toBeNull();
  });

  it("allows only named intelligence discovery workflows", () => {
    expect(validateAssistantAction({
      type: "search_intelligence",
      workflowId: "wildfire-monitoring",
    }, "")).toEqual({ type: "search_intelligence", workflowId: "wildfire-monitoring" });
    expect(validateAssistantAction({
      type: "search_intelligence",
      workflowId: "custom-workflow",
    }, "")).toBeNull();
  });

  it("only starts Sentinel-2 NDVI processing on an explicit calculation request", () => {
    expect(validateAssistantAction(
      { type: "process_selected_sentinel2_ndvi" },
      "Calculate NDVI for the selected Sentinel-2 scene",
    )).toEqual({ type: "process_selected_sentinel2_ndvi" });
    expect(validateAssistantAction(
      { type: "process_selected_sentinel2_ndvi" },
      "Find Sentinel-2 observations of vegetation",
    )).toBeNull();
    expect(validateAssistantAction(
      { type: "process_selected_sentinel2_ndvi" },
      "Calculate NDVI",
    )).toEqual({ type: "process_selected_sentinel2_ndvi" });
    expect(validateAssistantAction(
      { type: "process_selected_sentinel2_ndvi" },
      "Create a vegetation index for this scene",
    )).toEqual({ type: "process_selected_sentinel2_ndvi" });
  });

  it("uses the current area by default and validates requested places", () => {
    expect(validateAssistantAction({ type: "search_nisar" }, "Find recent acquisitions")).toEqual({
      type: "search_nisar",
    });
    expect(validateAssistantAction({
      type: "search_nisar",
      locationQuery: "California",
    }, "Find NISAR acquisitions in California")).toEqual({
      type: "search_nisar",
      locationQuery: "California",
    });
    expect(validateAssistantAction({
      type: "search_nisar",
      locationQuery: "Japan",
    }, "Find NISAR acquisitions in California")).toBeNull();
    expect(validateAssistantAction({
      type: "search_nisar",
      region: "India",
    }, "Find recent NISAR acquisitions")).toBeNull();
    expect(validateAssistantAction({
      type: "search_nisar",
      region: "India",
      locationQuery: "India",
    }, "Find NISAR acquisitions in India")).toBeNull();
  });


  it("only queues a public NISAR GCOV comparison on an explicit processing request", () => {
    const action = {
      type: "run_nisar_gcov_change",
      beforeRecordId: "G1234567890-ASF",
      afterRecordId: "G1234567891-ASF",
      frequency: "frequencyA",
      polarizationTerm: "HHHH",
    };
    expect(validateAssistantAction(action, "Run a NISAR GCOV backscatter comparison for these acquisitions")).toEqual(action);
    expect(validateAssistantAction(action, "Find NISAR GCOV acquisitions")).toBeNull();
    expect(validateAssistantAction({ ...action, beforeRecordId: action.afterRecordId }, "Run a NISAR GCOV comparison")).toBeNull();
    expect(validateAssistantAction({ ...action, frequency: "frequencyC" }, "Run a NISAR GCOV comparison")).toBeNull();
  });

  it("only cancels a guest NISAR investigation when the user explicitly asks to stop it", () => {
    expect(validateAssistantAction(
      { type: "cancel_nisar_investigation" },
      "Cancel my NISAR investigation",
    )).toEqual({ type: "cancel_nisar_investigation" });
    expect(validateAssistantAction(
      { type: "cancel_nisar_investigation" },
      "Check my NISAR investigation status",
    )).toBeNull();
  });

  it("only requests guest NISAR status when the user asks for an investigation update", () => {
    expect(validateAssistantAction({ type: "get_nisar_investigation_status" }, "Check the status of my NISAR investigation")).toEqual({
      type: "get_nisar_investigation_status",
    });
    expect(validateAssistantAction({ type: "get_nisar_investigation_status" }, "Explain NISAR GCOV")).toBeNull();
  });

  it("allows global intelligence scope only when the user requests it", () => {
    expect(validateAssistantAction({
      type: "search_intelligence",
      workflowId: "flood-water",
      scope: "global",
    }, "Find global flood observations")).toEqual({
      type: "search_intelligence",
      workflowId: "flood-water",
      scope: "global",
    });
    expect(validateAssistantAction({
      type: "search_intelligence",
      workflowId: "flood-water",
      scope: "global",
    }, "Find flood observations")).toBeNull();
  });
});
