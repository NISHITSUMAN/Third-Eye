import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";

const PRODUCT = /^NISAR_[LS][0-3]_[A-Z]{2}_GCOV_[A-Za-z0-9_]+$/;
const CONCEPT = /^[CG][A-Za-z0-9_-]{8,}$/;
const MAX_BODY_BYTES = 24_000;

function adminClient() {
  const url = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function hex(bytes: Uint8Array) {
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}
async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
function clientAddress(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const candidates = forwarded?.split(",").map(value => value.trim()).filter(Boolean) ?? [];
  return candidates.at(-1) || request.headers.get("x-real-ip") || "unknown";
}
function validAOI(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !["Polygon", "MultiPolygon"].includes(String(value.type))) return false;
  try {
    return Array.isArray(value.coordinates) &&
      new TextEncoder().encode(JSON.stringify(value.coordinates)).byteLength <= 100_000;
  } catch {
    return false;
  }
}
async function createGuestJob(request: Request) {
  const client = adminClient();
  if (!client) return json({ error: "Guest processing is not configured. Add the Supabase service-role key to server environment variables." }, 503);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json({ error: "The investigation request is too large." }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json({ error: "Send a valid JSON request." }, 400); }
  if (!isRecord(body) || !validAOI(body.aoi)) return json({ error: "A valid Polygon or MultiPolygon AOI is required." }, 400);

  const required = ["beforeProductId", "beforeCollectionConceptId", "beforeGranuleConceptId", "afterProductId", "afterCollectionConceptId", "afterGranuleConceptId"] as const;
  if (required.some(key => typeof body[key] !== "string" || !(body[key] as string).trim())) {
    return json({ error: "Both real NISAR GCOV acquisitions and their NASA CMR identifiers are required." }, 400);
  }
  if (!PRODUCT.test(body.beforeProductId as string) || !PRODUCT.test(body.afterProductId as string) ||
      !CONCEPT.test(body.beforeCollectionConceptId as string) || !CONCEPT.test(body.afterCollectionConceptId as string) ||
      !CONCEPT.test(body.beforeGranuleConceptId as string) || !CONCEPT.test(body.afterGranuleConceptId as string)) {
    return json({ error: "The selected acquisition metadata is not a supported NISAR GCOV pair." }, 400);
  }
  if (!["frequencyA", "frequencyB"].includes(String(body.frequency)) ||
      !["HHHH", "HVHV", "VVVV", "VHVH", "RHRH", "RVRV"].includes(String(body.polarizationTerm))) {
    return json({ error: "Choose a supported GCOV frequency and polarization term." }, 400);
  }
  const afterAcquiredAt = typeof body.afterAcquiredAt === "string" ? body.afterAcquiredAt.trim() : "";
  if (afterAcquiredAt && (!/^\d{4}-\d{2}-\d{2}T/.test(afterAcquiredAt) ||
      !/(?:Z|[+-]\d{2}:\d{2})$/i.test(afterAcquiredAt) ||
      !Number.isFinite(Date.parse(afterAcquiredAt)))) {
    return json({ error: "The later NISAR acquisition timestamp must be valid ISO-8601 with a timezone." }, 400);
  }

  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const salt = process.env.GUEST_RATE_LIMIT_SALT?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();
  const fingerprintHash = await sha256(salt + ":" + clientAddress(request));
  const { data, error } = await client.rpc("enqueue_guest_nisar_gcov_change_job", {
    p_guest_token_hash: tokenHash,
    p_fingerprint_hash: fingerprintHash,
    p_before_product_id: body.beforeProductId,
    p_before_collection_concept_id: body.beforeCollectionConceptId,
    p_before_granule_concept_id: body.beforeGranuleConceptId,
    p_after_product_id: body.afterProductId,
    p_after_collection_concept_id: body.afterCollectionConceptId,
    p_after_granule_concept_id: body.afterGranuleConceptId,
    p_aoi_geojson: body.aoi,
    p_frequency: body.frequency,
    p_polarization_term: body.polarizationTerm,
  });
  if (error) {
    const limited = error.message.includes("rate-limit") || error.message.includes("active guest");
    return json({ error: limited ? error.message : "The guest investigation could not be queued. Check database migrations and selected acquisition metadata." }, limited ? 429 : 400);
  }
  if (typeof data !== "string") return json({ error: "The processing service returned an invalid job identifier." }, 502);
  // Store the catalog acquisition time alongside the existing worker parameters.
  // The worker uses it only to discover a temporally matched independent reference.
  const { error: metadataError } = await client.from("scientific_jobs").update({
    nisar_parameters: {
      before_granule_concept_id: body.beforeGranuleConceptId,
      after_product_id: body.afterProductId,
      after_collection_concept_id: body.afterCollectionConceptId,
      after_granule_concept_id: body.afterGranuleConceptId,
      frequency: body.frequency,
      polarization_term: body.polarizationTerm,
      ...(afterAcquiredAt ? { after_acquired_at: afterAcquiredAt } : {}),
    },
  }).eq("id", data).is("user_id", null);
  if (metadataError) {
    return json({ error: "The investigation was queued, but acquisition-time metadata could not be saved. Check the worker job before retrying." }, 503);
  }
  return json({ jobId: data, accessToken: token, expiresAt: new Date(Date.now() + 86_400_000).toISOString() }, 201);
}
export const Route = createFileRoute("/api/science/jobs")({
  server: { handlers: { POST: async ({ request }) => createGuestJob(request) } },
});
