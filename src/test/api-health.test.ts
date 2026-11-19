import { afterEach, describe, expect, it, vi } from "vitest";
import { buildHealthPayload } from "../routes/api.health";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("API health configuration and worker probe", () => {
  it("reports degraded when guest NISAR server credentials are missing", async () => {
    const health = await buildHealthPayload({
      GROQ_API_KEY: "groq-test-key",
      GROQ_MODEL: "test-model",
      VITE_SUPABASE_URL: "https://example.supabase.co",
    });

    expect(health.ok).toBe(true);
    expect(health.status).toBe("degraded");
    expect(health.services.guestNisarApi).toBe("configuration-required");
    expect(health.services.scienceWorker).toBe("configuration-required");
    expect(health.configuration.supabaseServiceRoleKeyPresent).toBe(false);
    expect(JSON.stringify(health)).not.toContain("groq-test-key");
  });

  it("does not report the platform fully configured when the worker URL is absent", async () => {
    const health = await buildHealthPayload({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "server-only-test-secret",
    });

    expect(health.status).toBe("degraded");
    expect(health.services.guestNisarApi).toBe("configured");
    expect(health.services.scienceWorker).toBe("configuration-required");
    expect(JSON.stringify(health)).not.toContain("server-only-test-secret");
  });

  it("reports NISAR worker readiness only when the worker advertises the required workflow", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      worker_running: true,
      workflows: ["sentinel2-ndvi", "nisar-gcov-change"],
      earthdata_configured: true,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const health = await buildHealthPayload({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "server-only-test-secret",
      SCIENCE_WORKER_URL: "https://worker.example.test/",
    });

    expect(fetchMock).toHaveBeenCalledWith("https://worker.example.test/health", expect.objectContaining({
      method: "GET",
      cache: "no-store",
    }));
    expect(health.status).toBe("configured");
    expect(health.services.scienceWorker).toBe("healthy");
    expect(health.worker.nisarWorkflowAvailable).toBe(true);
    expect(health.worker.earthdataConfigured).toBe(true);
    expect(JSON.stringify(health)).not.toContain("server-only-test-secret");
  });

  it("does not call a non-HTTPS worker URL", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const health = await buildHealthPayload({ SCIENCE_WORKER_URL: "http://worker.example.test" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(health.services.scienceWorker).toBe("configuration-invalid");
  });

  it("reports an unreachable worker without throwing or leaking details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private network detail")));

    const health = await buildHealthPayload({ SCIENCE_WORKER_URL: "https://worker.example.test" });

    expect(health.services.scienceWorker).toBe("unavailable");
    expect(health.worker.reason).toContain("could not connect");
    expect(JSON.stringify(health)).not.toContain("private network detail");
  });
});
