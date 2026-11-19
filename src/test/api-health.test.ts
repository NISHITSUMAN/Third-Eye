import { describe, expect, it } from "vitest";
import { buildHealthPayload } from "../routes/api.health";

describe("API health configuration", () => {
  it("reports the API as degraded when guest NISAR server credentials are missing", () => {
    const health = buildHealthPayload({
      GROQ_API_KEY: "groq-test-key",
      GROQ_MODEL: "test-model",
      VITE_SUPABASE_URL: "https://example.supabase.co",
    });

    expect(health.ok).toBe(true);
    expect(health.status).toBe("degraded");
    expect(health.services.guestNisarApi).toBe("configuration-required");
    expect(health.services.scienceWorker).toBe("not-probed");
    expect(health.configuration.supabaseServiceRoleKeyPresent).toBe(false);
    expect(JSON.stringify(health)).not.toContain("groq-test-key");
  });

  it("reports guest NISAR API configuration without exposing the secret", () => {
    const health = buildHealthPayload({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "server-only-test-secret",
      GROQ_API_KEY: "groq-test-key",
      GROQ_MODEL: "test-model",
    });

    expect(health.status).toBe("configured");
    expect(health.services.guestNisarApi).toBe("configured");
    expect(health.configuration.guestNisarApiConfigured).toBe(true);
    expect(health.configuration.supabaseServiceRoleKeyPresent).toBe(true);
    expect(JSON.stringify(health)).not.toContain("server-only-test-secret");
    expect(JSON.stringify(health)).not.toContain("groq-test-key");
  });

  it("accepts the public Supabase URL fallback used by the guest API", () => {
    const health = buildHealthPayload({
      VITE_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "server-only-test-secret",
    });

    expect(health.services.guestNisarApi).toBe("configured");
  });
});
