import { createFileRoute } from "@tanstack/react-router";
import { getIntelligenceWorkflow, isIntelligenceWorkflowId } from "@/lib/intelligence-workflows";
import { verifyPlanetaryComputerVisualization } from "@/lib/planetary-computer-server";

const MAX_BODY_BYTES = 16_000;

function failure(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handlePlanetaryComputerVisualization(request: Request): Promise<Response> {
  let input: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return failure("The imagery request is too large.", 413);
    }
    input = JSON.parse(text) as unknown;
  } catch {
    return failure("Provide a valid JSON imagery request.", 400);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return failure("Provide a supported workflow, collection, and catalog item ID.", 400);
  }
  const record = input as Record<string, unknown>;
  if (!isIntelligenceWorkflowId(record.workflowId) ||
    typeof record.collectionId !== "string" ||
    typeof record.itemId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,200}$/.test(record.itemId)) {
    return failure("Provide a supported workflow, collection, and catalog item ID.", 400);
  }
  const workflow = getIntelligenceWorkflow(record.workflowId);
  if (!workflow.planetaryComputerCollections.some(collection => collection.id === record.collectionId)) {
    return failure("The collection is not supported by this intelligence workflow.", 400);
  }
  try {
    const visualization = await verifyPlanetaryComputerVisualization(
      record.workflowId,
      record.collectionId,
      record.itemId,
      request.signal,
    );
    return Response.json(visualization, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800" },
    });
  } catch (error) {
    if (request.signal.aborted) return failure("The imagery request was cancelled.", 499);
    const message = error instanceof Error ? error.message : "The observation imagery could not be verified.";
    const status = message.includes("does not publish a verified public tile") ? 404 : 502;
    if (status === 502) console.error("Planetary Computer imagery verification failed.", error);
    return failure(message, status);
  }
}

export const Route = createFileRoute("/api/planetary-computer/visualization")({
  server: {
    handlers: {
      POST: async ({ request }) => handlePlanetaryComputerVisualization(request),
    },
  },
});
