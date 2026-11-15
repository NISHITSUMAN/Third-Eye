import type { MeteomaticsContext } from "./planetary-computer";

const API_BASE_URL = "https://api.meteomatics.com";
const CACHE_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

interface WeatherCacheEntry {
  result: MeteomaticsContext;
  expiresAt: number;
  staleUntil: number;
}

interface MeteomaticsRecord {
  parameter?: string;
  coordinates?: Array<{
    lat?: number;
    lon?: number;
    dates?: Array<{ date?: string; value?: number }>;
  }>;
}

const cache = new Map<string, WeatherCacheEntry>();

export function meteomaticsConfigured(): boolean {
  return Boolean(process.env["METEOMATICS_USERNAME"]?.trim() && process.env["METEOMATICS_PASSWORD"]?.trim());
}

function configuredResult(): MeteomaticsContext {
  return {
    source: "Meteomatics",
    configured: true,
    status: "configured",
    observedAt: null,
    values: [],
    warning: null,
  };
}

function validWeatherValue(parameter: string, value: unknown): MeteomaticsContext["values"][number] | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (parameter === "t_2m:C" && value >= -120 && value <= 70) {
    return { parameter: "temperature", label: "Temperature", value, unit: "°C" };
  }
  if (parameter === "precip_1h:mm" && value >= 0 && value <= 1000) {
    return { parameter: "precipitation", label: "1-hour precipitation", value, unit: "mm" };
  }
  if (parameter === "wind_speed_10m:ms" && value >= 0 && value <= 200) {
    return { parameter: "wind-speed", label: "Wind speed", value, unit: "m/s" };
  }
  return null;
}

function cacheKey(latitude: number, longitude: number) {
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
}

async function requestWeather(
  url: string,
  authorization: string,
  signal?: AbortSignal,
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal?.aborted) throw new Error("The weather context request was cancelled.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const forwardAbort = () => controller.abort();
    signal?.addEventListener("abort", forwardAbort, { once: true });
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", Authorization: authorization },
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new Error(`Meteomatics returned HTTP ${response.status}.`);
        if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 200));
          continue;
        }
        throw error;
      }
      return await response.json() as unknown;
    } catch (error) {
      if (signal?.aborted) throw new Error("The weather context request was cancelled.");
      if (error instanceof Error && error.message.startsWith("Meteomatics returned HTTP ")) throw error;
      lastError = controller.signal.aborted
        ? new Error("Meteomatics timed out after 10 seconds.")
        : error;
      if (attempt === 1) throw lastError;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", forwardAbort);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Meteomatics request failed.");
}

export async function fetchMeteomaticsContext(
  latitude: number | null,
  longitude: number | null,
  signal?: AbortSignal,
): Promise<MeteomaticsContext> {
  const username = process.env["METEOMATICS_USERNAME"]?.trim();
  const password = process.env["METEOMATICS_PASSWORD"]?.trim();
  if (!username || !password) {
    return {
      source: "Meteomatics",
      configured: false,
      status: "not-configured",
      observedAt: null,
      values: [],
      warning: "Add METEOMATICS_USERNAME and METEOMATICS_PASSWORD to the server environment to enable weather context.",
    };
  }
  if (latitude === null || longitude === null) return configuredResult();

  const key = cacheKey(latitude, longitude);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.result;

  const parameters = ["t_2m:C", "precip_1h:mm", "wind_speed_10m:ms"];
  const url = `${API_BASE_URL}/now/${parameters.join(",")}/${latitude},${longitude}/json`;

  try {
    const credentials = Buffer.from(`${username}:${password}`).toString("base64");
    const payload = await requestWeather(url, `Basic ${credentials}`, signal) as { data?: MeteomaticsRecord[] };
    if (!Array.isArray(payload.data)) throw new Error("Meteomatics returned an unexpected response.");

    const values: MeteomaticsContext["values"] = [];
    const timestamps: string[] = [];
    const returnedParameters = new Set<string>();
    const invalidParameters = new Set<string>();
    for (const record of payload.data) {
      if (typeof record.parameter !== "string") continue;
      returnedParameters.add(record.parameter);
      const point = record.coordinates?.[0];
      const date = point?.dates?.[0];
      if (date?.date && Number.isFinite(Date.parse(date.date))) timestamps.push(new Date(date.date).toISOString());
      const value = validWeatherValue(record.parameter, date?.value);
      if (value) values.push(value);
      else if (parameters.includes(record.parameter)) invalidParameters.add(record.parameter);
    }

    const missing = parameters.filter((parameter) => !returnedParameters.has(parameter));
    const warning = values.length === 0
      ? "Meteomatics returned no usable weather values for this AOI."
      : missing.length || invalidParameters.size
        ? [
            missing.length ? `Missing: ${missing.join(", ")}.` : "",
            invalidParameters.size ? `Unusable values: ${[...invalidParameters].join(", ")}.` : "",
          ].filter(Boolean).join(" ")
        : null;
    const result: MeteomaticsContext = {
      source: "Meteomatics",
      configured: true,
      status: warning ? "partial" : "ready",
      observedAt: timestamps.sort().at(-1) ?? null,
      values,
      warning,
    };
    cache.delete(key);
    cache.set(key, { result, expiresAt: now + CACHE_TTL_MS, staleUntil: now + 10 * CACHE_TTL_MS });
    while (cache.size > 64) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return result;
  } catch (error) {
    if (signal?.aborted) throw new Error("The weather context request was cancelled.");
    if (cached && cached.staleUntil > now) {
      return {
        ...cached.result,
        status: "partial",
        warning: "Meteomatics is unavailable; showing previously cached weather context.",
      };
    }
    throw error;
  }
}
