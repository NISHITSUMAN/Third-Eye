import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";

function adminClient() {
  const url = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } });
}
function hex(bytes: Uint8Array) {
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}
async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
function bearer(request: Request) {
  const value = request.headers.get("authorization") || "";
  const match = /^Bearer ([a-f0-9]{64})$/.exec(value);
  return match?.[1] ?? null;
}
async function readJob(request: Request, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Investigation not found." }, 404);
  const client = adminClient();
  const token = bearer(request);
  if (!client || !token) return json({ error: "A valid guest access token is required." }, 401);
  const tokenHash = await sha256(token);
  const { data, error } = await client.from("scientific_jobs")
    .select("id,workflow_id,status,stage,progress,error_message,result,provenance,created_at,completed_at,guest_expires_at")
    .eq("id", id)
    .eq("guest_token_hash", tokenHash)
    .is("user_id", null)
    .maybeSingle();
  if (error || !data || !data.guest_expires_at || new Date(data.guest_expires_at).getTime() <= Date.now()) {
    return json({ error: "Investigation not found or its guest access has expired." }, 404);
  }

  let result: Record<string, unknown> | null = data.result && typeof data.result === "object"
    ? data.result as Record<string, unknown>
    : null;
  if (data.status === "completed" && result) {
    const expected = "guest/" + id + "/nisar-gcov-change.tif";
    if (result.raster_path !== expected) return json({ error: "The stored result failed its output-path integrity check." }, 500);
    const { data: signed, error: signError } = await client.storage.from("scientific-results").createSignedUrl(expected, 900, { download: true });
    if (signError || !signed?.signedUrl) return json({ error: "The scientific output is temporarily unavailable." }, 503);
    result = { ...result, raster_url: signed.signedUrl };
    if (result.preview_path !== undefined) {
      const expectedPreview = "guest/" + id + "/nisar-gcov-change-preview.png";
      if (result.preview_path !== expectedPreview) {
        return json({ error: "The stored preview failed its output-path integrity check." }, 500);
      }
      const { data: preview, error: previewError } = await client.storage.from("scientific-results").createSignedUrl(expectedPreview, 900);
      if (previewError || !preview?.signedUrl) return json({ error: "The scientific preview is temporarily unavailable." }, 503);
      result = { ...result, preview_url: preview.signedUrl };
    }
    if (result.screening_mask_path !== undefined) {
      const expectedScreening = "guest/" + id + "/nisar-negative-change-screening.tif";
      if (result.screening_mask_path !== expectedScreening) {
        return json({ error: "The screening mask failed its output-path integrity check." }, 500);
      }
      const { data: screening, error: screeningError } = await client.storage.from("scientific-results").createSignedUrl(expectedScreening, 900, { download: true });
      if (screeningError || !screening?.signedUrl) return json({ error: "The screening mask is temporarily unavailable." }, 503);
      result = { ...result, screening_mask_url: screening.signedUrl };
    }
    if (result.uncertainty_path !== undefined) {
      const expectedUncertainty = "guest/" + id + "/nisar-gcov-uncertainty.tif";
      if (result.uncertainty_path !== expectedUncertainty) {
        return json({ error: "The uncertainty layer failed its output-path integrity check." }, 500);
      }
      const { data: uncertainty, error: uncertaintyError } = await client.storage.from("scientific-results").createSignedUrl(expectedUncertainty, 900, { download: true });
      if (uncertaintyError || !uncertainty?.signedUrl) return json({ error: "The uncertainty layer is temporarily unavailable." }, 503);
      result = { ...result, uncertainty_url: uncertainty.signedUrl };
    }
    if (result.water_screening_mask_path !== undefined) {
      const expectedWaterScreening = "guest/" + id + "/nisar-candidate-new-water-screening.tif";
      if (result.water_screening_mask_path !== expectedWaterScreening) {
        return json({ error: "The candidate-water screening layer failed its output-path integrity check." }, 500);
      }
      const { data: waterScreening, error: waterScreeningError } = await client.storage.from("scientific-results").createSignedUrl(expectedWaterScreening, 900, { download: true });
      if (waterScreeningError || !waterScreening?.signedUrl) return json({ error: "The candidate-water screening layer is temporarily unavailable." }, 503);
      result = { ...result, water_screening_mask_url: waterScreening.signedUrl };
    }
  }
  return json({
    job: {
      id: data.id,
      workflowId: data.workflow_id,
      status: data.status,
      stage: data.stage,
      progress: data.progress,
      errorMessage: data.error_message,
      result,
      provenance: data.provenance,
      createdAt: data.created_at,
      completedAt: data.completed_at,
      expiresAt: data.guest_expires_at,
    },
  });
}
async function cancelJob(request: Request, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Investigation not found." }, 404);
  const client = adminClient();
  const token = bearer(request);
  if (!client || !token) return json({ error: "A valid guest access token is required." }, 401);
  const tokenHash = await sha256(token);
  const { data: job, error: readError } = await client.from("scientific_jobs")
    .select("id,status")
    .eq("id", id)
    .eq("guest_token_hash", tokenHash)
    .is("user_id", null)
    .maybeSingle();
  if (readError || !job) return json({ error: "Investigation not found." }, 404);
  if (job.status === "queued") {
    const { error } = await client.from("scientific_jobs").update({
      status: "cancelled", stage: "cancelled", progress: 100,
      completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", id).eq("guest_token_hash", tokenHash).eq("status", "queued");
    if (error) return json({ error: "The investigation could not be cancelled." }, 503);
  } else if (job.status === "processing") {
    const { error } = await client.from("scientific_jobs").update({
      cancel_requested_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", id).eq("guest_token_hash", tokenHash).eq("status", "processing");
    if (error) return json({ error: "The investigation could not be cancelled." }, 503);
  }
  return readJob(request, id);
}
export const Route = createFileRoute("/api/science/jobs/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => readJob(request, params.id),
      DELETE: async ({ request, params }) => cancelJob(request, params.id),
    },
  },
});
