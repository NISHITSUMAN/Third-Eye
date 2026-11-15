import { createFileRoute } from "@tanstack/react-router";
import type { Geometry } from "geojson";
import { validateGeometry } from "@/lib/analysis";
import { isIntelligenceWorkflowId } from "@/lib/intelligence-workflows";
import { searchPlanetaryComputer } from "@/lib/planetary-computer-server";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY_BYTES = 1_000_000;

function validDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function failure(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

async function parseBody(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) throw new Error("The observation search request is too large.");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new Error("The observation search request is too large.");
  }
  return JSON.parse(text) as unknown;
}

export async function handlePlanetaryComputerSearch(request: Request): Promise<Response> {
        let body: unknown;
        try {
          body = await parseBody(request);
        } catch (error) {
          const tooLarge = error instanceof Error && error.message.includes("too large");
          return failure(
            error instanceof Error ? error.message : "The request body must be valid JSON.",
            tooLarge ? 413 : 400,
          );
        }
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return failure("Provide a workflow, date range, and optional AOI geometry.", 400);
        }
        const input = body as Record<string, unknown>;
        if (!isIntelligenceWorkflowId(input.workflowId)) {
          return failure("Choose a supported intelligence workflow.", 400);
        }
        if (!validDay(input.startDate) || !validDay(input.endDate) || input.startDate > input.endDate) {
          return failure("Use valid startDate and endDate values in YYYY-MM-DD format.", 400);
        }
        const today = new Date().toISOString().slice(0, 10);
        if (input.endDate > today) return failure("The observation end date cannot be in the future.", 400);

        let geometry: Geometry | null = null;
        if (input.geometry !== null && input.geometry !== undefined) {
          try {
            geometry = validateGeometry(input.geometry).geometry;
          } catch (error) {
            return failure(error instanceof Error ? error.message : "The AOI geometry is invalid.", 400);
          }
        }

        try {
          const result = await searchPlanetaryComputer(
            input.workflowId,
            input.startDate,
            input.endDate,
            geometry,
            request.signal,
          );
          return Response.json(result, {
            headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800" },
          });
        } catch (error) {
          if (request.signal.aborted) return failure("The observation search was cancelled.", 499);
          console.error("Microsoft Planetary Computer STAC search failed.", error);
          return failure(
            error instanceof Error ? error.message : "Microsoft Planetary Computer search failed.",
            502,
          );
        }
}

export const Route = createFileRoute("/api/planetary-computer/search")({
  server: {
    handlers: {
      POST: async ({ request }) => handlePlanetaryComputerSearch(request),
    },
  },
});
