import { afterEach, describe, expect, it, vi } from "vitest";
import { handleClimateContext } from "../routes/api.climate.context";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function climateDays() {
  return Array.from({ length: 31 }, (_, index) => {
    const date = new Date(Date.UTC(2025, 0, index + 1));
    return date.toISOString().slice(0, 10);
  });
}

describe("historical climate context", () => {
  it("validates coordinates and summarizes real provider fields", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/archive")) {
        expect(url.searchParams.get("models")).toBe("era5_land");
        expect(url.searchParams.get("daily")).toBe("temperature_2m_mean,precipitation_sum");
        return new Response(JSON.stringify({
          daily: {
            time: climateDays(),
            temperature_2m_mean: Array(31).fill(10),
            precipitation_sum: Array(31).fill(2),
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ elevation: [1250] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const invalid = await handleClimateContext(new Request("http://localhost/api/climate/context?lat=91&lng=0"));
    expect(invalid.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();

    const response = await handleClimateContext(new Request("http://localhost/api/climate/context?lat=31.1&lng=77.2"));
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result).toMatchObject({
      status: "ready",
      coordinates: { latitude: 31.1, longitude: 77.2 },
      monthlySummary: [{
        month: 1,
        meanTemperatureC: 10,
        meanMonthlyPrecipitationMm: 62,
        completeYears: 1,
      }],
      elevation: { value: 1250, unit: "m" },
      limitations: expect.arrayContaining([
        expect.stringContaining("not a 30-year climate normal or forecast"),
        expect.stringContaining("not a validated crop-suitability model"),
      ]),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns an explicit partial result when elevation is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/archive")) {
        return new Response(JSON.stringify({
          daily: {
            time: climateDays(),
            temperature_2m_mean: Array(31).fill(8),
            precipitation_sum: Array(31).fill(1),
          },
        }), { status: 200 });
      }
      return new Response("unavailable", { status: 503 });
    }));

    const response = await handleClimateContext(new Request("http://localhost/api/climate/context?lat=17.9&lng=73.6"));
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.status).toBe("partial");
    expect(result.elevation).toBeNull();
    expect(result.warning).toContain("Elevation could not be retrieved");
  });
});
