export interface AssistantCapabilityGroup {
  id: string;
  title: string;
  description: string;
  examples: string[];
}

export const ASSISTANT_CAPABILITIES: AssistantCapabilityGroup[] = [
  {
    id: "questions",
    title: "Ask and understand",
    description: "Answer general knowledge questions, explain Earth and science concepts, interpret visible catalog metadata, and state what evidence is or is not available.",
    examples: [
      "Explain how SAR radar sees through clouds.",
      "What does this NISAR product code mean?",
      "What can these selected observations tell me—and what can’t they tell me?",
      "Analyze NISAR surface change for my selected area.",
    ],
  },
  {
    id: "places",
    title: "Find places and set the area",
    description: "Search geocoded place names, countries, regions, cities, landmarks, decimal or DMS coordinates, and supported bounds; move the map and set the AOI.",
    examples: [
      "Show me Nepal on the globe.",
      "Set the area to 34.2, 77.6.",
      "Use California as the area of interest.",
    ],
  },
  {
    id: "observations",
    title: "Discover satellite observations",
    description: "Choose relevant NASA CMR NISAR or Planetary Computer STAC searches based on the request, geography, dates, and available evidence; focus loaded records on the map.",
    examples: [
      "Find recent NISAR GCOV acquisitions over Alaska.",
      "Find Sentinel-2 observations of the current area this month.",
      "Look for flood and water observations near Bangladesh.",
      "Focus the latest currently loaded observation on the map.",
    ],
  },
  {
    id: "events",
    title: "Inspect public event context",
    description: "Refresh and inspect source-reported USGS magnitude 5+ earthquakes and NASA EONET events. These reports are not satellite detections.",
    examples: [
      "Show recent USGS earthquakes.",
      "What wildfire events does NASA EONET report?",
      "Turn on the earthquake layer.",
    ],
  },
  {
    id: "weather",
    title: "Check local weather context",
    description: "Request Meteomatics temperature, one-hour precipitation, and wind at the selected AOI center when server credentials and access are configured.",
    examples: [
      "Check the weather at the current area.",
      "What is the temperature and wind near Nairobi?",
      "Is weather data configured?",
    ],
  },
  {
    id: "environment",
    title: "Compare environmental context",
    description: "Retrieve five-year ERA5-Land monthly temperature and precipitation summaries plus approximate grid elevation for the selected area or up to five candidate places together, compare retrieved factors as screening evidence, and map ranked candidates.",
    examples: [
      "Compare Maharashtra and Himachal Pradesh for strawberry farming.",
      "What are some candidate regions in India for strawberries?",
      "What environmental factors support this comparison?",
    ],
  },
  {
    id: "map",
    title: "Control the map and globe",
    description: "Switch between 2D and 3D, change supported layer visibility, set dates, focus a supplied coordinate or geocoded place, and open Explore, Data, Observations, Events, Discover, or Analysis.",
    examples: [
      "Switch to the 2D map.",
      "Turn on NISAR GCOV and USGS earthquakes.",
      "Show the analysis tools on the shared globe.",
    ],
  },
  {
    id: "workflow",
    title: "Discover and process observations",
    description: "Search the supported environmental workflows and display returned catalog records. For a selected Sentinel-2 L2A scene, calculate a single-date NDVI raster. For two loaded, compatible NISAR GCOV acquisitions and a polygon AOI, queue a public guest gamma0 backscatter-change measurement and inspect its result without an account.",
    examples: [
      "Monitor wildfire observations in Greece.",
      "Find land and forest observations for the current area.",
      "Show soil and agriculture satellite observations in Maharashtra.",
      "Calculate NDVI for the selected Sentinel-2 scene over this area.",
    ],
  },
  {
    id: "planning",
    title: "Screen geographic candidates",
    description: "Use relevant available environmental predictors and general requirements to compare named candidate places, return qualitative ranked findings with limitations, and show verified locations on the map. This is not a validated suitability model.",
    examples: [
      "What are the best places in India to grow strawberries?",
      "What can I grow here this month?",
      "Compare Maharashtra and Himachal Pradesh for strawberry farming.",
    ],
  },
];

export const ASSISTANT_LIMITATIONS = [
  "NISAR guest GCOV processing measures after-minus-before gamma0 backscatter change only. It does not provide interferograms, water/flood/fire/deformation classifications, or calibrated confidence. Sentinel-2 NDVI is a single-date measurement, not a crop-health diagnosis or validated change finding.",
  "No general web search or guaranteed live news, forecasts, or facts beyond the connected providers.",
  "Meteomatics weather is unavailable until optional server credentials and API access are configured.",
  "Catalog records and source-reported events must never be described as measured impacts or detections.",
  "Environmental comparisons are screening-level only; soil, irrigation, land cover, long-term climate normals, and validated crop models are unavailable.",
];

export function isAssistantCapabilityQuestion(message: string) {
  return /\b(?:what can (?:you|(?:the )?(?:ai|assistant|third eye)) do|what can i ask|what should i ask|how can you help|show (?:me )?(?:your )?capabilities|list (?:all )?(?:your )?capabilities|your capabilities|list everything you can do|list (?:all )?(?:the )?things (?:i|people|users) (?:can|could) ask(?: (?:you|(?:the )?(?:ai|assistant|third eye))(?: to do)?)?)\b/i.test(message);
}

export function formatAssistantCapabilities() {
  return [
    "Here is what I can do in Third Eye:",
    ...ASSISTANT_CAPABILITIES.map(group =>
      `${group.title}: ${group.description} Examples: ${group.examples.join(" ")}`,
    ),
    `Important limits: ${ASSISTANT_LIMITATIONS.join(" ")}`,
  ].join("\n\n");
}
