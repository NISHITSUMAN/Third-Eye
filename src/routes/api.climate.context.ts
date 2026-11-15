import { createFileRoute } from "@tanstack/react-router";

type DailyClimate = {
  time: string[];
  temperature_2m_mean: Array<number | null>;
  precipitation_sum: Array<number | null>;
};

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDailyClimate(value: unknown): value is { daily: DailyClimate } {
  if (!isRecord(value) || !isRecord(value.daily)) return false;
  const daily = value.daily;
  return Array.isArray(daily.time) &&
    Array.isArray(daily.temperature_2m_mean) &&
    Array.isArray(daily.precipitation_sum) &&
    daily.time.length === daily.temperature_2m_mean.length &&
    daily.time.length === daily.precipitation_sum.length &&
    daily.time.every((date: unknown) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date));
}

function priorDate(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function startDate(endDate: string) {
  const date = new Date(`${endDate}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() - 5);
  return date.toISOString().slice(0, 10);
}

function monthlySummary(data: DailyClimate) {
  const monthly = new Map<string, { tempTotal: number; tempDays: number; rainTotal: number; rainDays: number }>();
  data.time.forEach((date, index) => {
    const key = date.slice(0, 7);
    const entry = monthly.get(key) ?? { tempTotal: 0, tempDays: 0, rainTotal: 0, rainDays: 0 };
    const temperature = data.temperature_2m_mean[index];
    const precipitation = data.precipitation_sum[index];
    if (typeof temperature === "number" && Number.isFinite(temperature)) {
      entry.tempTotal += temperature;
      entry.tempDays += 1;
    }
    if (typeof precipitation === "number" && Number.isFinite(precipitation)) {
      entry.rainTotal += precipitation;
      entry.rainDays += 1;
    }
    monthly.set(key, entry);
  });

  const byMonth = new Map<number, Array<{ temperature: number; precipitation: number }>>();
  for (const [yearMonth, values] of monthly) {
    const [yearText, monthText] = yearMonth.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (values.tempDays < daysInMonth || values.rainDays < daysInMonth) continue;
    const list = byMonth.get(month) ?? [];
    list.push({
      temperature: values.tempTotal / values.tempDays,
      precipitation: values.rainTotal,
    });
    byMonth.set(month, list);
  }

  return [...byMonth.entries()].sort(([a], [b]) => a - b).map(([month, values]) => ({
    month,
    meanTemperatureC: Number((values.reduce((sum, item) => sum + item.temperature, 0) / values.length).toFixed(1)),
    meanMonthlyPrecipitationMm: Number((values.reduce((sum, item) => sum + item.precipitation, 0) / values.length).toFixed(1)),
    completeYears: values.length,
  }));
}

async function fetchWithTimeout(url: URL, signal: AbortSignal) {
  return fetch(url, {
    headers: { Accept: "application/json" },
    signal,
  });
}

export async function handleClimateContext(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const latitude = Number(params.get("lat"));
  const longitude = Number(params.get("lng"));
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return json({ error: "Provide valid latitude and longitude coordinates." }, 400);
  }

  const endDate = priorDate(7);
  const climateUrl = new URL("https://archive-api.open-meteo.com/v1/archive");
  climateUrl.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    start_date: startDate(endDate),
    end_date: endDate,
    daily: "temperature_2m_mean,precipitation_sum",
    timezone: "UTC",
    models: "era5_land",
  }).toString();
  const elevationUrl = new URL("https://api.open-meteo.com/v1/elevation");
  elevationUrl.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
  }).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const [climateResponse, elevationResponse] = await Promise.allSettled([
      fetchWithTimeout(climateUrl, controller.signal),
      fetchWithTimeout(elevationUrl, controller.signal),
    ]);
    if (climateResponse.status !== "fulfilled" || !climateResponse.value.ok) {
      return json({ error: "Open-Meteo historical weather data is unavailable for this point right now." }, 502);
    }
    const climatePayload: unknown = await climateResponse.value.json();
    if (!isDailyClimate(climatePayload)) {
      return json({ error: "Open-Meteo returned an unexpected historical weather response." }, 502);
    }

    let elevationM: number | null = null;
    let elevationWarning: string | null = null;
    if (elevationResponse.status === "fulfilled" && elevationResponse.value.ok) {
      const elevationPayload: unknown = await elevationResponse.value.json();
      if (isRecord(elevationPayload) &&
          Array.isArray(elevationPayload.elevation) &&
          typeof elevationPayload.elevation[0] === "number" &&
          Number.isFinite(elevationPayload.elevation[0])) {
        elevationM = elevationPayload.elevation[0];
      } else {
        elevationWarning = "Elevation response was not usable.";
      }
    } else {
      elevationWarning = "Elevation could not be retrieved.";
    }

    const summary = monthlySummary(climatePayload.daily);
    if (!summary.length) {
      return json({ error: "No complete monthly summaries were available for the requested period." }, 502);
    }
    return json({
      status: elevationWarning ? "partial" : "ready",
      coordinates: { latitude, longitude },
      period: {
        start: climatePayload.daily.time[0],
        end: climatePayload.daily.time[climatePayload.daily.time.length - 1],
      },
      monthlySummary: summary,
      elevation: elevationM === null
        ? null
        : { value: elevationM, unit: "m", source: "Open-Meteo Elevation API" },
      sources: [
        {
          name: "Open-Meteo Historical Weather API · ERA5-Land",
          url: "https://open-meteo.com/en/docs/historical-weather-api",
          evidence: "Reanalysis-derived daily 2 m mean temperature and precipitation at the resolved grid point.",
        },
        ...(elevationM === null ? [] : [{
          name: "Open-Meteo Elevation API",
          url: "https://open-meteo.com/en/docs/elevation-api",
          evidence: "Grid elevation estimate; not a parcel survey.",
        }]),
      ],
      limitations: [
        "Five-year historical reanalysis summary, not a 30-year climate normal or forecast.",
        "Point/grid-cell values do not represent soil, irrigation, land cover, or within-region variation.",
        "These predictors support screening only and are not a validated crop-suitability model.",
        ...(elevationWarning ? [elevationWarning] : []),
      ],
      ...(elevationWarning ? { warning: elevationWarning } : {}),
    });
  } catch (error) {
    if (controller.signal.aborted) {
      return json({ error: "Open-Meteo did not respond within 12 seconds." }, 504);
    }
    console.error("Open-Meteo climate context request failed.", error);
    return json({ error: "Open-Meteo historical context could not be retrieved." }, 502);
  } finally {
    clearTimeout(timeout);
  }
}

export const Route = createFileRoute("/api/climate/context")({
  server: {
    handlers: {
      GET: async ({ request }) => handleClimateContext(request),
    },
  },
});
