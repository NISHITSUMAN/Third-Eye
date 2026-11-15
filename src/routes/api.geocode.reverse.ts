import { createFileRoute } from "@tanstack/react-router";
import { reversePlace } from "@/lib/geocode-server";

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" },
  });
}

export const Route = createFileRoute("/api/geocode/reverse")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const rawLatitude = url.searchParams.get("lat");
        const rawLongitude = url.searchParams.get("lon");
        const latitude = rawLatitude === null ? NaN : Number(rawLatitude);
        const longitude = rawLongitude === null ? NaN : Number(rawLongitude);
        if (!Number.isFinite(latitude) || Math.abs(latitude) > 90
          || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
          return json({ error: "Supply valid latitude and longitude coordinates." }, 400);
        }
        try {
          return json(await reversePlace(latitude, longitude, request.signal));
        } catch (error) {
          if (request.signal.aborted) return json({ error: "The reverse-geocoding request was cancelled." }, 499);
          console.error("Reverse geocoding failed.", error);
          return json({
            error: error instanceof Error ? error.message : "Reverse geocoding is unavailable.",
            status: "upstream-error",
          }, 502);
        }
      },
    },
  },
});
