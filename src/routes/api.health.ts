import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const hasGroqKey = Boolean(process.env.GROQ_API_KEY?.trim());
        const hasGroqModel = Boolean(process.env.GROQ_MODEL?.trim());
        return Response.json({
          ok: true,
          service: "third-eye",
          timestamp: new Date().toISOString(),
          services: { nasaCmr: "public", groq: hasGroqKey && hasGroqModel ? "configured" : "configuration-required" },
          configuration: {
            groqApiKeyPresent: hasGroqKey,
            groqModelConfigured: hasGroqModel,
          },
        }, { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
