import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMeteomaticsContext } from "../lib/meteomatics-server";
import { handleMeteomaticsContext } from "../routes/api.meteomatics.context";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("optional Meteomatics context", () => {
  it("reports missing server credentials without requesting or inventing weather", async () => {
    vi.stubEnv("METEOMATICS_USERNAME", "");
    vi.stubEnv("METEOMATICS_PASSWORD", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMeteomaticsContext(47.4, 9.3);
    expect(result).toMatchObject({
      source: "Meteomatics",
      configured: false,
      status: "not-configured",
      values: [],
    });
    expect(result.warning).toContain("METEOMATICS_USERNAME");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses server-only Basic auth, validates provider values, and caches the result", async () => {
    vi.stubEnv("METEOMATICS_USERNAME", "private-user");
    vi.stubEnv("METEOMATICS_PASSWORD", "private-password");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { parameter: "t_2m:C", coordinates: [{ dates: [{ date: "2025-01-03T12:00:00Z", value: 8.5 }] }] },
          { parameter: "precip_1h:mm", coordinates: [{ dates: [{ date: "2025-01-03T12:00:00Z", value: 0.4 }] }] },
          { parameter: "wind_speed_10m:ms", coordinates: [{ dates: [{ date: "2025-01-03T12:00:00Z", value: -999 }] }] },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMeteomaticsContext(47.4131, 9.34);
    const cached = await fetchMeteomaticsContext(47.4131, 9.34);
    expect(result).toEqual(cached);
    expect(result).toMatchObject({
      configured: true,
      status: "partial",
      observedAt: "2025-01-03T12:00:00.000Z",
      values: [
        { parameter: "temperature", value: 8.5, unit: "°C" },
        { parameter: "precipitation", value: 0.4, unit: "mm" },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/now/t_2m:C,precip_1h:mm,wind_speed_10m:ms/47.4131,9.34/json");
    expect(new Headers(init.headers).get("authorization")).toMatch(/^Basic /);
    expect(JSON.stringify(result)).not.toContain("private-password");
    expect(JSON.stringify(result)).not.toContain("private-user");
  });

  it("validates coordinates at the API boundary", async () => {
    vi.stubEnv("METEOMATICS_USERNAME", "");
    vi.stubEnv("METEOMATICS_PASSWORD", "");
    const invalid = await handleMeteomaticsContext(new Request("http://localhost/api/meteomatics/context?lat=91&lng=0"));
    expect(invalid.status).toBe(400);

    const configuredState = await handleMeteomaticsContext(new Request("http://localhost/api/meteomatics/context"));
    expect(configuredState.status).toBe(200);
    await expect(configuredState.json()).resolves.toMatchObject({
      configured: false,
      status: "not-configured",
      values: [],
    });
  });

  it("retries a transient Meteomatics service error once", async () => {
    vi.stubEnv("METEOMATICS_USERNAME", "private-user");
    vi.stubEnv("METEOMATICS_PASSWORD", "private-password");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { parameter: "t_2m:C", coordinates: [{ dates: [{ date: "2025-01-03T12:00:00Z", value: 8.5 }] }] },
            { parameter: "precip_1h:mm", coordinates: [{ dates: [{ date: "2025-01-03T12:00:00Z", value: 0.4 }] }] },
            { parameter: "wind_speed_10m:ms", coordinates: [{ dates: [{ date: "2025-01-03T12:00:00Z", value: 2.4 }] }] },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchMeteomaticsContext(1.1, 2.2)).resolves.toMatchObject({ status: "ready" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
