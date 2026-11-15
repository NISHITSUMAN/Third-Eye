import { createFileRoute } from "@tanstack/react-router";
import { fetchMeteomaticsContext } from "@/lib/meteomatics-server";

function failure(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handleMeteomaticsContext(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const rawLatitude = url.searchParams.get("lat");
        const rawLongitude = url.searchParams.get("lng");
        if ((rawLatitude === null) !== (rawLongitude === null)) {
          return failure("Provide both lat and lng coordinates.", 400);
        }

        let latitude: number | null = null;
        let longitude: number | null = null;
        if (rawLatitude !== null && rawLongitude !== null) {
          latitude = Number(rawLatitude);
          longitude = Number(rawLongitude);
          if (
            !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
            Math.abs(latitude) > 90 || Math.abs(longitude) > 180
          ) return failure("Weather context coordinates must be valid latitude and longitude values.", 400);
        }

        try {
          const result = await fetchMeteomaticsContext(latitude, longitude, request.signal);
          return Response.json(result, {
            headers: { "Cache-Control": "private, no-store" },
          });
        } catch (error) {
          if (request.signal.aborted) return failure("The weather context request was cancelled.", 499);
          console.error("Meteomatics context request failed.", error);
          return failure(error instanceof Error ? error.message : "Meteomatics weather context failed.", 502);
        }
}

export const Route = createFileRoute("/api/meteomatics/context")({
  server: {
    handlers: {
      GET: async ({ request }) => handleMeteomaticsContext(request),
    },
  },
});
