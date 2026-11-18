import type { NISARGranule } from "./nasa-cmr";

export const GUEST_NISAR_TOKEN_KEY = "third-eye:guest-nisar-capability:v1";
export const GUEST_NISAR_CAPABILITY_EVENT = "third-eye:guest-nisar-capability";

export type GuestNISARCapability = { jobId: string; token: string };
export type GuestNISARJob = {
  id: string;
  workflowId: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  stage: string;
  progress: number;
  errorMessage: string | null;
  result: Record<string, unknown> | null;
  provenance: Record<string, unknown> | null;
  expiresAt: string;
};

function browser() {
  if (typeof window === "undefined") throw new Error("Guest NISAR investigations are available in the browser only.");
  return window;
}

export function readGuestNISARCapability(): GuestNISARCapability | null {
  try {
    const raw = browser().sessionStorage.getItem(GUEST_NISAR_TOKEN_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<GuestNISARCapability>;
    return typeof value.jobId === "string" && typeof value.token === "string" && /^[a-f0-9]{64}$/.test(value.token)
      ? { jobId: value.jobId, token: value.token }
      : null;
  } catch {
    return null;
  }
}

function saveCapability(value: GuestNISARCapability) {
  const currentWindow = browser();
  currentWindow.sessionStorage.setItem(GUEST_NISAR_TOKEN_KEY, JSON.stringify(value));
  currentWindow.dispatchEvent(new Event(GUEST_NISAR_CAPABILITY_EVENT));
}

async function parseResponse<T>(response: Response, fallback: string): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(fallback);
  }
  if (!response.ok) {
    const error = payload && typeof payload === "object" && !Array.isArray(payload) &&
      "error" in payload && typeof payload.error === "string" ? payload.error : fallback;
    throw new Error(error);
  }
  return payload as T;
}

export async function getGuestNISARStatus(capability = readGuestNISARCapability()): Promise<GuestNISARJob> {
  if (!capability) throw new Error("No guest NISAR investigation is available in this browser session.");
  const response = await fetch("/api/science/jobs/" + encodeURIComponent(capability.jobId), {
    headers: { Authorization: "Bearer " + capability.token, Accept: "application/json" },
    cache: "no-store",
  });
  const payload = await parseResponse<{ job?: GuestNISARJob }>(response, "Guest investigation status could not be loaded.");
  if (!payload.job) throw new Error("The guest investigation response did not contain a job.");
  return payload.job;
}

export async function submitGuestNISARComparison(input: {
  before: NISARGranule;
  after: NISARGranule;
  aoi: GeoJSON.Geometry;
  frequency: "frequencyA" | "frequencyB";
  polarizationTerm: "HHHH" | "HVHV" | "VVVV" | "VHVH" | "RHRH" | "RVRV";
}): Promise<{ capability: GuestNISARCapability; job: GuestNISARJob }> {
  const response = await fetch("/api/science/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      beforeProductId: input.before.granuleId.replace(/\.h5$/i, ""),
      beforeCollectionConceptId: input.before.collectionConceptId,
      beforeGranuleConceptId: input.before.conceptId,
      afterProductId: input.after.granuleId.replace(/\.h5$/i, ""),
      afterCollectionConceptId: input.after.collectionConceptId,
      afterGranuleConceptId: input.after.conceptId,
      aoi: input.aoi,
      frequency: input.frequency,
      polarizationTerm: input.polarizationTerm,
    }),
  });
  const payload = await parseResponse<{ jobId?: string; accessToken?: string }>(response, "The NISAR investigation could not be queued.");
  if (!payload.jobId || !payload.accessToken || !/^[a-f0-9]{64}$/.test(payload.accessToken)) {
    throw new Error("The guest processing service returned an invalid access capability.");
  }
  const capability = { jobId: payload.jobId, token: payload.accessToken };
  saveCapability(capability);
  const job = await getGuestNISARStatus(capability);
  return { capability, job };
}

export async function cancelGuestNISARJob(capability = readGuestNISARCapability()): Promise<GuestNISARJob> {
  if (!capability) throw new Error("No guest NISAR investigation is available in this browser session.");
  const response = await fetch("/api/science/jobs/" + encodeURIComponent(capability.jobId), {
    method: "DELETE",
    headers: { Authorization: "Bearer " + capability.token, Accept: "application/json" },
    cache: "no-store",
  });
  const payload = await parseResponse<{ job?: GuestNISARJob }>(response, "Guest investigation cancellation failed.");
  if (!payload.job) throw new Error("The cancellation response did not contain a job.");
  return payload.job;
}

export function forgetGuestNISARCapability() {
  browser().sessionStorage.removeItem(GUEST_NISAR_TOKEN_KEY);
  browser().dispatchEvent(new Event(GUEST_NISAR_CAPABILITY_EVENT));
}
