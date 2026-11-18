# NISAR GCOV guest investigations

This document describes Third Eye's public NISAR GCOV comparison workflow. It is intentionally separate from the authenticated Sentinel-2 NDVI workflow. Dashboard, Learn, and the public guest investigation interface do not require a Google account.

## What the workflow measures

The worker requests an AOI-bounded subset of two NISAR GCOV acquisitions through NASA Harmony, reads the requested covariance power layer, and calculates:

`delta_dB = 10 log10(after_gamma0_power) - 10 log10(before_gamma0_power)`

The result is a derived gamma0 backscatter-change raster in decibels. GCOV is a calibrated gamma0 product; the workflow does not apply radiometric terrain correction a second time.

This output is **not** a water mask, flood extent, landslide detection, deformation measurement, fire detection, hazard probability, or calibrated confidence score. A change in backscatter can have several possible causes, including moisture, roughness, vegetation, surface structure, acquisition conditions, and processing.

## Acquisition pairing and discovery

The browser's NISAR investigation panel screens the loaded GCOV records for a compatible pair. It checks product-name metadata including instrument, processing type, relative orbit, direction, frame, frequency bandwidth, polarization mode, source mode, processing release, orbit-accuracy class, full frame coverage, and a 1–365 day separation. The selected covariance term must be available for the requested frequency and mode.

The compatible-pair suggestions are a metadata pre-screen, not proof that data are accessible or that two rasters will align. The worker repeats its own product compatibility checks before downloading. It then verifies the actual returned rasters. Users can still select records manually, but the panel blocks obviously incompatible pairs and the worker remains authoritative.

## Spatial processing and raster outputs

NASA Harmony accepts a geographic bounding rectangle for the subset request. After both rasters are retrieved, the worker projects the submitted GeoJSON Polygon or MultiPolygon into the GCOV raster CRS and rasterizes it against the exact pixel grid. Only pixel centres inside the geometry are retained (`all_touched=false`); polygon holes are respected. Pixels outside the polygon and invalid in either acquisition are set to nodata in the derived raster.

Boundary pixels are not area-fraction weighted. Very small AOIs can contain no pixel centres at the product resolution and will be rejected. This polygon mask is applied after the bounding-rectangle subset is retrieved; it does not change the upstream Harmony subset request.

The comparison requires identical CRS, affine transform, and raster dimensions. It rejects misaligned pairs rather than silently resampling. It uses raster masks, nodata, finite positive gamma0 power, and supported positive number-of-looks metadata for validity. GCOV adaptive-averaging mask values are retained as metadata and are not guessed to be a Boolean validity mask.

The worker publishes:
- A georeferenced Cloud Optimized GeoTIFF containing after-minus-before backscatter change (dB).
- A transparent PNG quicklook for rapid inspection. Its diverging stretch is clipped to the 98th percentile of absolute valid change. Blue represents negative change, neutral near-zero change, and red positive change. It is a display-only image, is not georeferenced, and must not be used for GIS measurements.
- A georeferenced negative-backscatter screening COG using a fixed -3 dB threshold. Class 1 means only that the measured change is at or below -3 dB; class 0 means a valid pixel is above the threshold; 255 is nodata. It is an exploratory screening layer, not a water/flood mask or a calibrated classifier. The threshold is exposed in result metadata and must not be described as scientifically calibrated.
- A summary of valid pixels, mean/median/percentile/minimum/maximum change, valid area, AOI pixel coverage, and processing metadata.
- A provenance record describing the inputs, grids, mask method, processing choices, and limitations.

The pipeline also reports threshold-sensitivity counts at selected negative dB thresholds and the p10-to-p90 spread of observed pixel differences. The valid-pixel coverage denominator is the count of pixel centres inside the AOI that are present in the returned raster extent; it does not measure polygon area outside that returned dataset. These are descriptive diagnostics only. They are not a water-classification result, formal uncertainty interval, confidence probability, or accuracy metric.

When aligned `numberOfLooks` layers are available for both acquisitions, the worker also reports a per-pixel approximate standard error for the dB difference using a first-order delta-method approximation for independent gamma-distributed power estimates: `(10 / ln(10)) * sqrt(1/L_before + 1/L_after)`. The result summary reports median standard error, median and 90th-percentile approximate 95% half-widths, and the fraction of absolute changes larger than 1.96 standard errors. This is a measurement-noise diagnostic under stated assumptions; it is not a calibrated confidence score, scene-level formal interval, multiple-testing-adjusted significance test, or hazard probability. If either acquisition lacks aligned positive number-of-looks data, the uncertainty diagnostic is explicitly unavailable rather than fabricated.

## Required deployment configuration

### Web application (server-only Vercel environment)

- `SUPABASE_URL`: project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only service-role key. Never expose this as a `VITE_` variable or send it to the browser.
- `GUEST_RATE_LIMIT_SALT`: optional high-entropy server-only salt for hashing the rate-limit fingerprint. If omitted, the service-role key is used as the salt.

The browser receives only a random 256-bit guest capability. The database stores its SHA-256 hash. The capability is returned once at submission and kept in the current browser session. It is not an account identity and is never passed to the language model.

### Science worker (Hack Club Nest environment)

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `EARTHDATA_TOKEN` (preferred), or both `EARTHDATA_USERNAME` and `EARTHDATA_PASSWORD`
- Existing worker settings such as `PORT`, `SCIENCE_WORKER_POLL_SECONDS`, and `SCIENCE_PROCESSING_DIRECTORY`

Earthdata credentials must remain on the worker. Do not put them in Vercel client variables, source control, or browser requests.

To verify a real Harmony request without printing credentials, install the worker package and run `python scripts/verify_nisar_access.py --collection-id C... --granule-id G... --bounds WEST SOUTH EAST NORTH`. The collection and granule IDs must come from real NASA CMR GCOV records; use a small AOI. The script reads `EARTHDATA_TOKEN` (or the username/password pair) only from the worker environment, requests one acquisition, opens the returned power COG, and prints metadata without exposing credentials. It verifies one acquisition only, not a before/after pair or a validated scientific result.

## Database migration order

Apply repository migrations in timestamp order, including:

1. `20261117112238_sentinel2_ndvi_jobs.sql`
2. `20261118202000_nisar_gcov_change_jobs.sql`
3. `20261118203000_guest_nisar_capabilities.sql`

The guest migration adds nullable ownership for guest rows, hashed capabilities, 24-hour expiry, rate-limit records, a service-role-only enqueue RPC, and queue-claim logic that includes eligible guest jobs. It does not grant anonymous clients direct table access. Applying and verifying this migration in the target Supabase project is a deployment prerequisite.

## Request lifecycle

1. The visitor loads real NISAR GCOV catalog metadata from NASA CMR, selects a polygon AOI, and chooses a compatible before/after pair, frequency, and diagonal covariance term.
2. The server validates the request, generates a random capability, stores only its SHA-256 digest, derives a rate-limit fingerprint, and calls the service-role-only database RPC.
3. The worker claims the job from the same queue used by the existing scientific worker.
4. The worker checks product compatibility and requests both Harmony subsets using the AOI bounds.
5. It checks raster-grid identity, applies the exact polygon pixel-centre mask, calculates the dB difference, generates the preview and uploads both outputs to the private `scientific-results` bucket under `guest/{job_id}/`.
6. The browser polls with the capability. A completed result receives short-lived signed URLs for the change GeoTIFF, the negative-change screening COG, and the PNG preview.
7. The worker periodically removes expired guest result objects (GeoTIFF and preview), job rows, and old rate-limit rows.

Guest submission limits are three submissions per fingerprint per hour and one active guest job per fingerprint. Guest capabilities expire after 24 hours. Signed download URLs last 15 minutes and are refreshed when the browser requests status again.

The Groq assistant can explicitly queue a comparison using already-loaded GCOV records and the current polygon AOI, and can check the browser's guest-job status. The bearer token stays in browser session storage and is never included in model context. The assistant must not claim a job is complete until the status endpoint returns a completed result.

## Validation and scientific interpretation

The current guest job does not retrieve an independent reference raster. It therefore does not calculate a water/flood classification, confusion matrix, precision, recall, IoU, calibrated confidence, or uncertainty probability. The worker's generic validation utilities and threshold-sensitivity diagnostics are not a substitute for reference-data integration.

A validated water workflow still requires a documented independent reference such as OPERA DSWx or JRC Global Surface Water, appropriate acquisition-time matching, spatial alignment, product maturity review, a sampling and exclusions protocol, and class-specific validation metrics. Rainfall or hydrological context can help explain conditions but cannot independently validate a water mask.

No real-data featured investigation should be published until a compatible pair has been successfully processed with valid Earthdata authentication, the result has been reviewed, and the data provenance and interpretation limits are recorded.

## Operational checks

- `GET /health` on the worker confirms the service and queue thread are running; it does not prove Earthdata authentication or a successful Harmony request.
- Apply and verify Supabase migrations before enabling guest submissions.
- Confirm server-only Vercel environment variables without exposing their values.
- Run the Python worker test suite and frontend test/lint/build workflow after changes.
- Submit a small AOI with a real compatible pair before calling the workflow live.
- Confirm the worker uploaded the expected guest GeoTIFF and PNG, and that the API returns signed URLs.
- Verify cancellation, expiry, and cleanup on a non-production test job before relying on them operationally.

Do not describe a catalog result, a queued job, a backscatter difference, or a successful raster download as a validated flood detection.


## Independent reference agreement (implemented validation primitive)

The worker package now includes a time-aware independent-raster comparison primitive in
`science_worker.nisar.reference`. It accepts a binary candidate mask and a separately
supplied classified reference GeoTIFF, requires an explicit source/product name and
UTC-offset acquisition timestamps, rejects references outside the configured temporal
window, reprojects with nearest-neighbour resampling, excludes nodata and unmapped
classes, and reports confusion counts, precision, recall, F1, IoU, and reference coverage.

The reference class mapping is deliberately explicit: callers must supply both water
and land class codes from the selected product's current specification. The code does
not guess DSWx class values. This avoids treating cloud, layover, shadow, ocean, or
other special classes as land.

### Reference source status and interpretation

- OPERA DSWx-S1 is a production, near-global SAR water product and can be considered as
  an independent Sentinel-1 reference where its spatial and temporal coverage is
  suitable. It is not a NISAR measurement. A product-specific helper is provided for
  its WTR layer using the published classes: water = 1 (open water) and 3 (inundated
  vegetation); land = 0; excluded = 250 (HAND mask), 251 (layover/shadow), and 255
  (fill). These codes follow the NASA/JPL DSWx-S1 Product Specification v1.0.0.
  The helper still requires the caller to select the correct tile and verify the
  granule acquisition time and overlap.
- OPERA DSWx-HLS is an optical HLS-derived water product. It can provide complementary
  reference evidence where cloud conditions, acquisition timing, and coverage permit.
- OPERA DSWx-NI (NISAR-derived) is listed as under development in the JPL DSWx product
  suite. It must not be treated as an available operational reference until NASA/JPL
  publishes a validated product release and accessible granules.
- JRC Global Surface Water is a long-term water-occurrence/change baseline, not an
  event-time flood truth layer. It must not be used as a direct event validation
  reference without a documented temporal sampling protocol.
- GPM precipitation is hydrometeorological context, not a water-extent reference and
  cannot be used to calculate classification accuracy.

The current public guest job does **not** automatically discover or download these
reference rasters, does not generate a water-classification prediction, and does not
run this validator as part of the guest job yet. The validator is a tested processing
primitive for a subsequent reference-backed workflow. No precision/recall/F1/IoU or
featured real-data case study should be displayed until both a documented candidate
classifier and an independent, time-matched reference are actually processed.

Official product status: https://www.jpl.nasa.gov/go/opera/products/dswx-product-suite/
Official OPERA product catalogue: https://www.jpl.nasa.gov/go/opera/products/


The OPERA DSWx-S1 WTR class mapping used by the helper is documented in the
[NASA/JPL DSWx-S1 Product Specification v1.0.0](https://d2pn8kiwq2w21t.cloudfront.net/documents/OPERA_DSWx-S1_Product_Spec_v1.0.0_D-108761_RevA_2024-08-16_.pdf).
