# Third Eye

Third Eye is an Earth-observation explorer. It combines an interactive 3D Earth (CesiumJS), a 2D map (MapLibre), NASA CMR and Planetary Computer catalog discovery, separately attributed public-event sources, timeline controls, area-of-interest tools, and a Groq-powered application controller when configured.

> **Data honesty:** no fabricated NISAR acquisitions, observations, event geometries, metrics, or analysis outputs are shipped. Catalog results are discovery records; the first actual raster workflow is a bounded, single-scene Sentinel-2 L2A NDVI calculation from source B04/B08/SCL assets. It is not a crop-health diagnosis or an environmental-impact finding. USGS and NASA EONET are independent, source-reported context. Meteomatics, when configured, adds separate weather context. Basemap imagery is geographic context, not a NISAR measurement.

## Run locally

The single web application lives at the repository root. Requirements: a current Node.js version compatible with Vite 8, or Bun.

```sh
npm install
npm run dev
```

Or with Bun:

```sh
bun install
bun run dev
```

Useful checks:

```sh
bun run test
bun run lint
bun run build
```

## One application, distinct experiences

The public intro, project landing site, learning experience, and Earth Intelligence dashboard are feature areas in this TanStack Start application—not separate Vite projects or copied builds:

- `/` and the mission pages use `src/features/intro/`.
- `/landing/*` uses `src/features/landing/`, with its own visual system and page modules.
- `/learn` uses `src/features/learn/` and the shared app authentication/session.
- Dashboard routes and shared Earth-observation services remain in `src/routes/`, `src/components/`, and `src/lib/`.

All experiences share this package manifest, router, dependencies, `public/` assets, and build. The Python raster worker under `science-worker/` remains a separate runtime service by design.

## Unified application and sign-in

The public entry at `/` is the cinematic introduction. It transitions to the public Home page at `/landing`. Home, Team, and Links are available without an account. Choosing the Earth Intelligence Dashboard (`/dashboard`) or Learn (`/learn`) requires a Supabase session. Landing's Learn and project workspace routes are protected as well. The sign-in flow returns the user to the page they requested.

Set these client-visible Supabase values in a local `.env.local` file (or the matching deployment environment):

```dotenv
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_public_key
```

The integrated project currently points to Supabase project `ytfiycktrqqurawdhkph`; local `.env.local` contains a configured URL and publishable key. The available Supabase tools can verify the project and URL, but cannot inspect or enable Auth providers. The reported `Unsupported provider: provider is not enabled` error means Google still needs to be enabled in Supabase Authentication → Providers.

To finish Google OAuth:

1. In Supabase project `ytfiycktrqqurawdhkph`, open Authentication → Providers → Google, enable Google, and enter a Google OAuth Web client ID and client secret. Do not put the client secret in this repository or a `VITE_` variable.
2. In Google Cloud, add the app origins you use (for example `http://localhost:5173`, `http://localhost:8080`, and `http://localhost:8081`) as Authorized JavaScript origins. Add `https://ytfiycktrqqurawdhkph.supabase.co/auth/v1/callback` as the Authorized redirect URI.
3. In Supabase Authentication → URL Configuration, set the Site URL to the deployed app origin and allow the callback route for each local/deployed origin. For local Vite, add `http://localhost:5173/auth/callback` and `http://127.0.0.1:5173/auth/callback`; if using port 8080 or 8081, add both `localhost` and `127.0.0.1` callback URLs for the port in use. For production, add `https://YOUR_DOMAIN/auth/callback`.
4. The app forwards `/auth/callback` to `/landing/auth/callback` and preserves the requested Dashboard or Learn destination.

The local Supabase URL and publishable key are already present in `.env.local`; never put a Supabase service-role key in a `VITE_` variable. The Google client ID/secret are not available in the repository or the connected Supabase tools, so provider enablement and a complete Google sign-in cannot be truthfully claimed until those credentials are entered.

## Connected public data sources

- **NASA CMR / NISAR catalog:** the Data page can query current collection metadata and search granules by selected collection, time range, and (when present) the AOI bounding box. Interactive coverage loads up to 100 recently revised records per selected product family, reports CMR's total match count, and offers paging to load subsequent records. The globe shows loaded records, not the entire global archive at once; a smaller AOI/date range can make a search more focused. It links to official CMR metadata and Earthdata Search. It does not download or process product files. Some data access workflows require an Earthdata Login.
- **Microsoft Planetary Computer STAC:** Intelligence workflows search allowlisted Sentinel-1 RTC, Sentinel-2 L2A, Landsat, and MODIS collections by date and optional AOI geometry. Collections are queried independently because the STAC service does not support searches spanning collections on different backends; a failed collection does not erase successful results from others. The 100-item display sample is balanced across successful collections so the newest source cannot hide other providers. NISAR remains the primary SAR mission; Planetary Computer is complementary. Returned items are source catalog metadata and footprints, not processed imagery or derived results. Complete successful searches are cached for five minutes, and a recent cached result can be shown if the provider is temporarily unavailable.
- **USGS earthquakes:** the Live Layers panel fetches source-reported magnitude 5+ earthquakes from the preceding two years via the USGS public GeoJSON catalog. Records retain magnitude, time, location, and source URLs where available. The layer is off by default so earthquake context does not dominate other Intelligence goals; enable it when needed. Earthquake questions in the assistant refresh this feed and answer from the returned records.
- **NASA EONET:** the Live Layers panel requests a bounded sample of up to 250 source-reported open and closed events from its preceding two-year archive window, and maps supported wildfire, flood, landslide, and volcanic categories when valid geometry is present. Like USGS earthquakes, the layer is off by default so public-event context does not obscure satellite catalog records.
- **Meteomatics weather context (optional):** when `METEOMATICS_USERNAME` and `METEOMATICS_PASSWORD` are configured on the server, the app requests current temperature, one-hour precipitation, and wind at the selected AOI center. No weather values are shown without a successful provider response. Missing credentials produce an explicit configuration state; credentials are never sent to the browser.
- Each public provider has separate health state, bounded timeouts, limited retries, and independent caching where appropriate. A failed USGS or EONET request does not discard the other feed's records. These are source snapshots, not continuous streaming feeds.
- Public-source records are displayed as **context**, not as NISAR observations, predicted hazards, or Third Eye scientific detections.

## Voice control

- Press the microphone or Ctrl/Cmd+Shift+Space to start a voice command. A short pause submits the recording automatically. Voice is never captured in the background, and there is no wake word.
- Optional Conversation Mode listens for follow-ups only after a voice command completes. It is off by default, can be enabled in Settings, and ends after the selected 5–60 second quiet window (15 seconds by default, up to six follow-ups). The microphone is not monitored during spoken replies; click the microphone or use the shortcut to explicitly interrupt and speak. Cancel stops capture, transcription, assistant requests, and playback.
- Settings also control microphone input and spoken responses. Third Eye can read concise replies aloud using Groq Orpheus (`canopylabs/orpheus-v1-english`, Hannah); short chunks are generated in parallel. Recognized user speech and the exact text sent for speech appear in a scrollable, screen-reader-accessible Voice Captions panel; typed commands remain available as a fallback.
- Voice control records in the browser and requires microphone permission, MediaRecorder, Web Audio, and audio playback support. User commands are sent to the assistant server and Groq's `whisper-large-v3-turbo` transcription API; the app does not store recordings. Transcription and natural speech generation both require the server-side `GROQ_API_KEY`, and provider data policies apply.
- Voice commands use the same allowlisted controls as typed commands: NISAR catalog searches, supported page navigation, live-feed layers, map/globe and time controls, and focusing a matching public event.

## Earth imagery and terrain

The 3D globe uses a multi-level imagery provider instead of relying solely on the low-resolution bundled Natural Earth II image.

- **Default:** Esri World Imagery, a tiled satellite/aerial basemap, with provider attribution enabled in Cesium's on-screen credit area. Imagery sharpness varies by place and available zoom level; it is not a guarantee of street-level detail.
- **Optional custom imagery:** set `VITE_EARTH_IMAGERY_URL` to a tile URL template with `{z}`, `{x}`, and `{y}`, plus `VITE_EARTH_IMAGERY_ATTRIBUTION`. Use only a provider whose licence, terms and usage limits permit this application.
- **Optional Cesium ion imagery:** set `VITE_CESIUM_ION_TOKEN` and, if needed, `VITE_CESIUM_ION_IMAGERY_ASSET_ID`. The default asset ID is `2`; check that the asset is available to your account and that its terms/attribution/quota are appropriate.
- **Optional 3D terrain:** set `VITE_CESIUM_TERRAIN=true` with a valid ion token and terrain access. If the terrain request fails, the globe retains ellipsoid terrain.
- If the preferred tile provider reports repeated tile errors, the globe falls back to Esri imagery and then the bundled low-resolution Natural Earth II image.

Example local `.env.local` (leave token empty unless you have configured ion access; do not commit real secrets):

```dotenv
VITE_CESIUM_ION_TOKEN=
VITE_CESIUM_ION_IMAGERY_ASSET_ID=2
VITE_CESIUM_TERRAIN=false
VITE_EARTH_IMAGERY_URL=
VITE_EARTH_IMAGERY_ATTRIBUTION=
METEOMATICS_USERNAME=
METEOMATICS_PASSWORD=
```

Variables prefixed with `VITE_` are exposed in the browser bundle. Only use client-scoped tokens, restrict them by domain where the provider supports it, and never put server secrets in client environment variables.
Meteomatics credentials are optional, server-only variables; do not prefix them with `VITE_`.

## Current capabilities and limitations

- NASA CMR collection and granule metadata, source footprints, browse links, and Earthdata references are queried live. Product colors distinguish NISAR catalog families; reported footprints remain outlined at global map scale. Dashed bounds are catalog bounding boxes, not radar swaths. This is catalog discovery, not scientific processing.
- The map panel separates **Workflows** from **Data layers**. Workflows search goal-specific records; Data layers is the single place to control map visibility and browse all eleven registered NISAR product families, including L0B raw science and calibration catalog records. Opening Data layers searches NASA CMR across those families and reports per-family loaded and match counts. This remains catalog discovery, not raster processing. Both tabs use the same map layers, so source footprints can overlap geographically without representing duplicate detections.
- The selected-observation panel exposes **Check Metadata** near the top. Opening it displays the normalized fields and complete metadata payload returned by the source, with nested fields expanded, a raw JSON view, and copy support; the human-readable observation overview remains available below.
- The Intelligence panel offers five actionable, AOI/date-driven goals: Wildfire Monitoring, Flood & Water, Land & Forest Change, Ice & Glacier Observation, and Soil & Agriculture. The active goal searches its selected NISAR CMR product families and complementary Planetary Computer catalogs on load and whenever the goal, AOI, or date range changes; users can also refresh manually. Those workflow searches are catalog discovery only; no derived NISAR science is performed.
- Planetary Computer results can be selected on the globe or 2D map and inspected as STAC metadata. For a selected Sentinel-2 L2A scene and polygon AOI only, users can queue actual B04/B08 NDVI processing. The private georeferenced preview appears on both map renderers, with opacity/visibility controls and a downloadable GeoTIFF.
- The Sentinel-2 workflow reads product-specific BOA calibration metadata, masks Scene Classification Layer quality classes and AOI exterior, validates the 10 m raster grid, and records the source item, algorithm, parameters, quality checks, summary statistics, and limitations. It does not calculate temporal change, crop condition, or validated detections. See [the science worker guide](./science-worker/README.md).
- Meteomatics is an optional server-side weather context provider. Without configured credentials the interface clearly reports that state and displays no weather measurements.
- USGS earthquakes and NASA EONET records are available as independent public context and are never labelled as NISAR detections.
- NISAR raster products are not downloaded, rendered as science rasters, or processed. Flood, fire, deformation, soil-moisture, and other derived outputs are unavailable rather than simulated.
- The Groq assistant can control supported viewer actions through a server-side allowlist. Without Groq configuration, only deterministic, limited viewer commands are available.
- The Groq assistant answers general-knowledge questions across ordinary topics and can explain loaded source records; it has no general web browsing, so current claims must come from connected providers. The in-app **What can I ask?** guide lists supported prompts and limitations.
- Selecting a NISAR, Planetary Computer, or public-event record automatically requests a Groq explanation using that record's provider metadata and spatially overlapping records already loaded in the app. It is an interpretation of catalog/source text, not pixel analysis or proof of an environmental impact; without Groq configuration, the panel reports the error and retains a product-guide fallback.
- The assistant can resolve a named place to the shared map/AOI, search observation workflows, and request Meteomatics weather context at a location when configured. Without Groq configuration, general-knowledge answers are unavailable; supported deterministic viewer/data actions can still work.
- Groq selects relevant tools per goal in a bounded investigation loop; structured tool outcomes are sent back for replanning before final synthesis. Environmental comparisons can retrieve five-year ERA5-Land temperature/precipitation summaries and approximate elevation for geocoded candidates, then create qualitative screening findings on the map. This is not a validated crop model: soil, irrigation, land cover, yield, and parcel-level conditions are not inferred.
- The assistant keeps a bounded conversation transcript in the user's browser, supports context-aware follow-ups, and executes requested provider searches before generating its final data-backed response. Task-relevant typed tools return structured source/evidence summaries; geographic corrections such as “check the whole country” replan against the corrected scope. Users can clear the saved transcript from the assistant panel.
- Current point weather does not establish road safety; catalog records do not calculate environmental change or prove an impact. Source data, Third Eye's analysis, and screening recommendations remain distinct.
- Voice and typed assistant commands can search NISAR and intelligence catalogs, resolve a user-named place into the shared AOI, control supported viewer layers and views, change the time range, navigate supported pages, and focus matching source-reported events. Searches preserve the current AOI unless the user names another place or explicitly requests global coverage.
- Place search uses Photon with Open-Meteo Geocoding as a fallback; assistant place searches use the same backend geocoder, and map clicks use BigDataCloud reverse geocoding. Decimal coordinates, DMS, bounding boxes and single-ring WKT polygons are parsed locally. Provider-supplied extents are preferred; approximate extents are clearly identified when a source does not return bounds.
- The app does not require a database, Redis, object storage, or a separately deployed worker for the catalog and viewer features that are currently implemented. A future large-raster processing service would require a separately deployed worker and storage; that infrastructure is not claimed as available.
- Run the test, lint and production build commands locally, then verify imagery loads in a real browser with WebGL and the chosen provider's terms/credentials.
- The public cinematic introduction uses a bundled NASA Landsat reference model and generated conceptual scenes. These are illustrative presentation assets, not live NISAR acquisitions or scientific outputs. Learn's interactive Earth orbit/telemetry, signal exercises, charts, and radar values are instructional simulations; only pages explicitly connected to NASA GIBS/Worldview or NASA Eyes display those external providers' content.


## Globe imagery and zoom overlays

The 3D Earth uses Esri World Imagery for the satellite/aerial basemap. Separate transparent Esri reference layers fade in above it: place names and administrative boundaries appear while zooming in, while roads/transportation references appear at closer scales. These are geographic context layers, not NISAR measurements; Cesium displays the source attribution.

The 2D MapLibre view remains an alternate view. It does not replace the main 3D globe during zoom.

## Backend API

- GET /api/health reports backend status and whether Groq is configured. It never returns secret values.
- GET /api/nisar/coverage queries NASA CMR for live NISAR collections and granules. It accepts startDate, endDate, products, and optional west/south/east/north bounds. Public catalog results are cached for five minutes.
- POST /api/planetary-computer/search accepts a named workflow, startDate, endDate, and optional validated GeoJSON geometry. Server-side collection allowlists bound searches to the workflow; results contain STAC metadata only.
- GET /api/meteomatics/context?lat=...&lng=... returns configuration status or a source-reported weather sample. It uses optional server-only credentials and never includes them in the response.
- GET /api/assistant reports whether both Groq server configuration values are present.
- POST /api/assistant calls Groq's OpenAI-compatible chat-completions API when configured. The browser bounds investigation to four planning rounds and eight actions, validates model-proposed actions against an allowlist, and returns structured tool outcomes for replanning. Geographic findings are geocoded, shown as numbered map markers or verified region boundaries, and selectable for details. The same endpoint accepts bounded speech-generation requests and returns WAV audio without exposing the server key. Without Groq configuration, only explicit map controls remain available; investigation tools are not guessed by topic-specific fallback rules.

### Configure Groq on Vercel

In Project → Settings → Environment Variables, add both server-only variables in the environments where Groq should be enabled:

    GROQ_API_KEY=your_groq_api_key
    GROQ_MODEL=a_model_currently_available_to_your_groq_account

Choose a model from Groq's current model catalog. There is intentionally no source-code model default, so a retired or unavailable model is not silently selected. Keep `GROQ_API_KEY` server-side; never prefix it with `VITE_`. Add the values in Vercel's server environment, then redeploy.

For local development, put `GROQ_API_KEY` and `GROQ_MODEL` in the repository-root `.env` or `.env.local` file. Vite loads these into the local server process only; they are not exposed to browser code. Restart `npm run dev` after changing either value. Check `/api/assistant` to confirm both values are detected without revealing them. An `Error: aborted` during a Vite restart means an in-flight request was interrupted; wait for the restart to finish and retry.

The assistant endpoint has request-size validation and a small per-runtime throttle. That throttle is not globally shared; before using a public Groq key for high traffic, configure Vercel Firewall rate limits or a shared rate-limit service. NASA CMR catalog access works without Groq credentials.

### Deployment requirements

The catalog/viewer application can deploy on the existing TanStack Start + Vercel setup. NASA CMR and Planetary Computer catalog access do not require private credentials. Groq is optional and requires only the two server environment variables above. Meteomatics weather context is optional and requires server-side `METEOMATICS_USERNAME` and `METEOMATICS_PASSWORD`; without them it remains explicitly unconfigured. Cesium imagery tokens are optional, browser-visible provider credentials and should be restricted by domain. The optional Sentinel-2 NDVI workflow requires the additive `supabase/migrations/20261117112238_sentinel2_ndvi_jobs.sql` schema/storage migration and a separate long-running Python worker with server-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The dashboard restores the current user's latest saved job after reload and refreshes signed URLs for completed outputs. The Vercel runtime does not run raster processing; without the worker, submitted jobs remain queued.

Heavy SAR processing is not deployed. The Sentinel-2 worker is a separate, bounded optical workflow and does not provide NISAR processing capabilities.

## NISAR data scope

Third Eye queries live NASA CMR metadata and displays source-provided granule footprints/bounds on the globe. These shapes show published acquisition coverage; they are not flood extent, deformation measurements, fire/damage detection, or other derived results. CMR records and product links are real, but full NISAR HDF5 product download and georeferenced raster/tile processing are not implemented here. That requires a separate ingestion, validation and scientific processing pipeline. A basemap or catalog footprint must not be described as processed radar imagery.

The app reads `BETA`, `PROVISIONAL`, or `VALIDATED` from each CMR collection identifier, displays `UNKNOWN` when no maturity token is present, and only searches maturity groups whose reported temporal extent overlaps the selected dates. These are provider labels, not validation performed by Third Eye; maturity groups may cover different dates and should not be treated as interchangeable.

The shared mission/product registry also documents Sentinel-1, RADARSAT-1, and RCM, but their providers are **not integrated**.

References: [NASA NISAR mission overview](https://science.nasa.gov/mission/nisar/mission-overview/), [ASF NISAR availability and maturity](https://hyp3-docs.asf.alaska.edu/nisar-docs/availability-overview/), [ASF NISAR product definitions](https://nisar-docs.asf.alaska.edu/products-overview/), and [NASA/ISRO S-band release notes](https://www.isro.gov.in/NISARS_Band_SAR_Data_Products_Release.html).
