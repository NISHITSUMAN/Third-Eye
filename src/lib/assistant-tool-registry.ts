import {
  ASSISTANT_LAYERS,
  ASSISTANT_PRODUCTS,
  ASSISTANT_ROUTES,
  ASSISTANT_WORKFLOWS,
} from "./assistant-actions";

type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      additionalProperties: false;
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
};

const string = (description: string, extra: Record<string, unknown> = {}) => ({
  type: "string",
  description,
  ...extra,
});
const number = (description: string, extra: Record<string, unknown> = {}) => ({
  type: "number",
  description,
  ...extra,
});

export const ASSISTANT_TOOL_REGISTRY: readonly ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_place",
      description: "Resolve a user-named place and set it as the shared map area of interest.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { query: string("Place name stated by the user.", { minLength: 2, maxLength: 120 }) },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weather_context",
      description: "Fetch current weather measurements at a named place or the current AOI. This does not establish road safety or crop suitability.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { locationQuery: string("Optional place name stated by the user.", { minLength: 2, maxLength: 120 }) },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_climate_context",
      description: "Retrieve consistent five-year ERA5-Land monthly temperature and precipitation summaries plus elevation for one to five candidate places, or for the selected AOI when no place is supplied. This is grid-cell screening context, not a forecast, climate normal, or crop model.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          locationQuery: string("One candidate place to geocode and inspect.", { minLength: 2, maxLength: 120 }),
          locationQueries: {
            type: "array",
            description: "Two to five named candidate places to profile consistently in one comparison.",
            minItems: 2,
            maxItems: 5,
            items: string("Candidate place to geocode and inspect.", { minLength: 2, maxLength: 120 }),
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "map_ranked_places",
      description: "Geocode and add up to eight named candidate places from the investigation to the shared map as selectable, ranked screening findings. Do not provide coordinates or numeric suitability scores.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          places: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: string("Candidate place name; the application verifies its location with the geocoder.", { minLength: 2, maxLength: 120 }),
                rank: { type: "integer", minimum: 1, maximum: 8 },
                rationale: string("Concise rationale grounded in the completed investigation.", { maxLength: 320 }),
                evidence: { type: "array", maxItems: 4, items: string("Observed or retrieved factor used.", { maxLength: 160 }) },
              },
              required: ["name", "rank", "rationale", "evidence"],
            },
          },
        },
        required: ["places"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_nisar_coverage",
      description: "Search the NASA CMR NISAR acquisition catalog using the current AOI/date range or a user-named place.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          locationQuery: string("Optional place name stated by the user.", { minLength: 2, maxLength: 120 }),
          region: string("Explicit geographic scope.", { enum: ["India", "Kashmir", "Ladakh", "Global"] }),
          productCodes: { type: "array", items: { type: "string", enum: ASSISTANT_PRODUCTS }, maxItems: 5 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_intelligence_observations",
      description: "Search allowlisted NASA CMR and Planetary Computer observation catalogs for a supported workflow. Results are discovery records, not derived analysis.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          workflowId: string("Supported observation workflow.", { enum: ASSISTANT_WORKFLOWS }),
          locationQuery: string("Optional place name stated by the user.", { minLength: 2, maxLength: 120 }),
          scope: string("Use global only when the user explicitly requests it.", { enum: ["global"] }),
        },
        required: ["workflowId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_nisar_gcov_change",
      description: "Queue a public guest NISAR GCOV before/after gamma0 backscatter comparison using two granules already present in the supplied NISAR catalog context and the current polygon AOI. Only call for an explicit user request to run/process/compare NISAR GCOV or backscatter. It queues work; never claim completion until a later status call returns a completed result.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          beforeRecordId: string("Exact id of the earlier loaded NISAR GCOV granule from context.data.nisar.records."),
          afterRecordId: string("Exact id of the later loaded NISAR GCOV granule from context.data.nisar.records."),
          frequency: string("GCOV frequency grid.", { enum: ["frequencyA", "frequencyB"] }),
          polarizationTerm: string("Diagonal GCOV covariance term.", { enum: ["HHHH", "HVHV", "VVVV", "VHVH", "RHRH", "RVRV"] }),
        },
        required: ["beforeRecordId", "afterRecordId", "frequency", "polarizationTerm"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_nisar_surface_change",
      description: "Analyze surface change using the public NISAR GCOV workflow. This queues an actual before/after gamma0 backscatter comparison over the current polygon AOI using two already-loaded compatible GCOV records. Only call when the user explicitly asks to analyze, process, compare, or calculate NISAR surface change. It does not produce a water/flood classification. Never claim completion until get_nisar_investigation_status confirms a completed job.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          beforeRecordId: string("Exact id of the earlier loaded NISAR GCOV granule from context.data.nisar.records."),
          afterRecordId: string("Exact id of the later loaded NISAR GCOV granule from context.data.nisar.records."),
          frequency: string("GCOV frequency grid.", { enum: ["frequencyA", "frequencyB"] }),
          polarizationTerm: string("Diagonal GCOV covariance term.", { enum: ["HHHH", "HVHV", "VVVV", "VHVH", "RHRH", "RVRV"] }),
        },
        required: ["beforeRecordId", "afterRecordId", "frequency", "polarizationTerm"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_nisar_investigation",
      description: "Cancel the current public guest NISAR investigation in this browser session. Only call when the user explicitly asks to stop or cancel it. The request uses the browser-held bearer capability; never expose that token to the model.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "download_nisar_export",
      description: "Download an export from the completed public guest NISAR investigation in this browser session. Only call when the user explicitly asks to download, export, or save a specific format. Supported formats: PDF report, CSV summary, JSON provenance, GeoTIFF measurement, or negative-change screening mask. Do not reveal signed URLs or bearer capabilities.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { format: { type: "string", enum: ["pdf", "csv", "json", "geotiff", "screening_mask"] } },
        required: ["format"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_nisar_investigation_status",
      description: "Read the current public guest NISAR investigation associated with this browser session. Use after queueing or when the user asks for status/results. Does not expose the guest bearer token to the model.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "process_selected_sentinel2_ndvi",
      description: "Start actual single-scene Sentinel-2 L2A NDVI processing from the currently selected loaded Sentinel-2 observation and the user's current polygon AOI. Use only when the user explicitly asks to calculate/process NDVI or a vegetation index. This queues work; never describe it as completed until a later result confirms completion.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "refresh_public_events",
      description: "Refresh independently attributed USGS and NASA EONET public-event context.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "select_loaded_result",
      description: "Select a result that is present in the supplied loaded-result context; never invent an ID.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { recordId: string("ID copied from a loaded result.", { minLength: 1, maxLength: 200 }) },
        required: ["recordId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fly_to_coordinates",
      description: "Move the shared map/globe to coordinates explicitly supplied by the user.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          lat: number("Latitude explicitly supplied by the user.", { minimum: -90, maximum: 90 }),
          lng: number("Longitude explicitly supplied by the user.", { minimum: -180, maximum: 180 }),
          altitude: number("Optional camera altitude.", { minimum: 0.002, maximum: 5 }),
        },
        required: ["lat", "lng"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_layer_visibility",
      description: "Enable or disable an allowlisted visible map layer.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          layer: string("Allowlisted layer.", { enum: ASSISTANT_LAYERS }),
          enabled: { type: "boolean" },
        },
        required: ["layer", "enabled"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "switch_earth_view",
      description: "Switch the shared Earth view between 2D and 3D.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { view: string("Requested Earth view.", { enum: ["2d", "3d"] }) },
        required: ["view"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_timeline_range",
      description: "Set a valid date range on the shared observation timeline.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          start: string("Inclusive start date.", { pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
          end: string("Inclusive end date.", { pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
        },
        required: ["start", "end"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "navigate_section",
      description: "Open an allowlisted Third Eye section.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { route: string("Allowlisted application route.", { enum: ASSISTANT_ROUTES }) },
        required: ["route"],
      },
    },
  },
];

const TOOL_ACTION: Record<string, (input: Record<string, unknown>) => unknown> = {
  search_place: input => ({ type: "search_location", locationQuery: input.query }),
  get_weather_context: input => ({ type: "get_weather_context", ...(input.locationQuery === undefined ? {} : { locationQuery: input.locationQuery }) }),
  get_climate_context: input => ({ type: "get_climate_context", ...input }),
  map_ranked_places: input => ({ type: "map_ranked_places", ...input }),
  search_nisar_coverage: input => ({ type: "search_nisar", ...input }),
  search_intelligence_observations: input => ({ type: "search_intelligence", ...input }),
  process_selected_sentinel2_ndvi: () => ({ type: "process_selected_sentinel2_ndvi" }),
  run_nisar_gcov_change: input => ({ type: "run_nisar_gcov_change", ...input }),
  analyze_nisar_surface_change: input => ({ type: "run_nisar_gcov_change", ...input }),
  get_nisar_investigation_status: () => ({ type: "get_nisar_investigation_status" }),
  cancel_nisar_investigation: () => ({ type: "cancel_nisar_investigation" }),
  refresh_public_events: () => ({ type: "refresh_live" }),
  select_loaded_result: input => ({ type: "select_result", recordId: input.recordId }),
  fly_to_coordinates: input => ({ type: "fly_to", ...input }),
  set_layer_visibility: input => ({ type: "set_layer", ...input }),
  switch_earth_view: input => ({ type: "switch_earth_view", ...input }),
  set_timeline_range: input => ({ type: "set_time_range", ...input }),
  navigate_section: input => ({ type: "navigate", ...input }),
};

export function assistantActionFromToolCall(name: string, input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const parsed = input as Record<string, unknown>;
  if (name === "apply_action") return parsed;
  return TOOL_ACTION[name]?.(parsed) ?? null;
}


