import { createFileRoute } from "@tanstack/react-router";

type HealthEnvironment = {
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  VITE_SUPABASE_URL?: string;
};

export function buildHealthPayload(env: HealthEnvironment = process.env) {
  const hasGroqKey = Boolean(env.GROQ_API_KEY?.trim());
  const hasGroqModel = Boolean(env.GROQ_MODEL?.trim());
  const hasSupabaseUrl = Boolean(env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim());
  const hasSupabaseServiceRoleKey = Boolean(env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  const guestNisarApiConfigured = hasSupabaseUrl && hasSupabaseServiceRoleKey;

  return {
    ok: true,
    service: "third-eye",
    timestamp: new Date().toISOString(),
    status: guestNisarApiConfigured ? "configured" : "degraded",
    services: {
      nasaCmr: "public",
      groq: hasGroqKey && hasGroqModel ? "configured" : "configuration-required",
      guestNisarApi: guestNisarApiConfigured ? "configured" : "configuration-required",
      scienceWorker: "not-probed",
    },
    configuration: {
      groqApiKeyPresent: hasGroqKey,
      groqModelConfigured: hasGroqModel,
      supabaseUrlPresent: hasSupabaseUrl,
      supabaseServiceRoleKeyPresent: hasSupabaseServiceRoleKey,
      guestNisarApiConfigured,
    },
  };
}

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => Response.json(buildHealthPayload(), {
        headers: { "Cache-Control": "no-store" },
      }),
    },
  },
});
