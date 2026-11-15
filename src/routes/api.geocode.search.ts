import { createFileRoute } from "@tanstack/react-router";
import { parseLocalGeoQuery } from "@/lib/geocode";
import { searchPlaces } from "@/lib/geocode-server";

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
  });
}

export const Route = createFileRoute("/api/geocode/search")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
        if (!query || query.length > 120) {
          return json({ error: "Enter a place name between 1 and 120 characters." }, 400);
        }
        const local = parseLocalGeoQuery(query);
        if (local) return json({ status: "ready", results: [local], warnings: [] });
        try {
          return json(await searchPlaces(query, request.signal));
        } catch (error) {
          if (request.signal.aborted) return json({ error: "The location search was cancelled." }, 499);
          console.error("Place search providers failed.", error);
          return json({
            error: error instanceof Error ? error.message : "Place search providers are unavailable.",
            status: "upstream-error",
          }, 502);
        }
      },
    },
  },
});
