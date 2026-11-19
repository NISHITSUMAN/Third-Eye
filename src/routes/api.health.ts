import { createFileRoute } from "@tanstack/react-router";

type HealthEnvironment = {
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  VITE_SUPABASE_URL?: string;
  SCIENCE_WORKER_URL?: string;
};

type WorkerHealth = {
  ok?: unknown;
  worker_running?: unknown;
  workflows?: unknown;
  earthdata_configured?: unknown;
};

async function probeScienceWorker(baseUrl: string | undefined) {
  if (!baseUrl?.trim()) {
    return {
      status: "configuration-required" as const,
      reason: "SCIENCE_WORKER_URL is not configured.",
      workflows: [] as string[],
      earthdataConfigured: false,
    };
  }

  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(normalized)) {
    return {
      status: "configuration-invalid" as const,
      reason: "SCIENCE_WORKER_URL must use HTTPS.",
      workflows: [] as string[],
      earthdataConfigured: false,
    };
  }

  try {
    const response = await fetch(normalized + "/health", {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3500),
      cache: "no-store",
    });
    if (!response.ok) {
      return {
        status: "unavailable" as const,
        reason: `Worker health endpoint returned HTTP ${response.status}.`,
        workflows: [] as string[],
        earthdataConfigured: false,
      };
    }

    const payload = await response.json() as WorkerHealth;
    const workflows = Array.isArray(payload.workflows)
      ? payload.workflows.filter((value): value is string => typeof value === "string")
      : [];
    const nisarReady = payload.ok === true &&
      payload.worker_running === true &&
      workflows.includes("nisar-gcov-change");

    return {
      status: nisarReady ? "healthy" as const : "degraded" as const,
      reason: nisarReady ? null : "Worker is reachable but does not advertise the required NISAR workflow.",
      workflows,
      earthdataConfigured: payload.earthdata_configured === true,
    };
  } catch {
    return {
      status: "unavailable" as const,
      reason: "The science worker health check timed out or could not connect.",
      workflows: [] as string[],
      earthdataConfigured: false,
    };
  }
}

export async function buildHealthPayload(env: HealthEnvironment = process.env) {
  const hasGroqKey = Boolean(env.GROQ_API_KEY?.trim());
  const hasGroqModel = Boolean(env.GROQ_MODEL?.trim());
  const hasSupabaseUrl = Boolean(env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim());
  const hasSupabaseServiceRoleKey = Boolean(env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  const guestNisarApiConfigured = hasSupabaseUrl && hasSupabaseServiceRoleKey;
  const worker = await probeScienceWorker(env.SCIENCE_WORKER_URL);

  return {
    ok: true,
    service: "third-eye",
    timestamp: new Date().toISOString(),
    status: guestNisarApiConfigured && worker.status === "healthy" ? "configured" : "degraded",
    services: {
      nasaCmr: "public",
      groq: hasGroqKey && hasGroqModel ? "configured" : "configuration-required",
      guestNisarApi: guestNisarApiConfigured ? "configured" : "configuration-required",
      scienceWorker: worker.status,
    },
    configuration: {
      groqApiKeyPresent: hasGroqKey,
      groqModelConfigured: hasGroqModel,
      supabaseUrlPresent: hasSupabaseUrl,
      supabaseServiceRoleKeyPresent: hasSupabaseServiceRoleKey,
      guestNisarApiConfigured,
      scienceWorkerUrlPresent: Boolean(env.SCIENCE_WORKER_URL?.trim()),
    },
    worker: {
      reason: worker.reason,
      workflows: worker.workflows,
      earthdataConfigured: worker.earthdataConfigured,
      nisarWorkflowAvailable: worker.workflows.includes("nisar-gcov-change"),
    },
  };
}

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => Response.json(await buildHealthPayload(), {
        headers: { "Cache-Control": "no-store" },
      }),
    },
  },
});
