# NISAR GCOV guest investigations

This document describes the public NISAR GCOV comparison workflow. It is intentionally separate from the existing Sentinel-2 NDVI workflow.

## What the workflow measures

The worker retrieves an AOI-bounded GCOV subset for two NISAR acquisitions through NASA Harmony, reads the returned GeoTIFF/COG layers, checks product compatibility, and calculates:

\`delta_dB = 10 log10(after_gamma0_power) - 10 log10(before_gamma0_power)\`

The result is a derived gamma0 backscatter-change raster in dB. It is not a water mask, flood extent, landslide detection, deformation measurement, or hazard probability.

The current implementation requires identical CRS, affine transform, and raster dimensions. It rejects misaligned pairs rather than silently resampling. It subsets by the AOI bounding rectangle; it does not yet clip pixels to arbitrary polygon edges. GCOV adaptive-averaging mask values are retained as metadata and are not interpreted as Boolean validity flags. Raster masks, nodata, finite positive power, and available positive number-of-looks values control valid pixels.

## Required deployment configuration

### Web application (server-only Vercel environment)

- \`SUPABASE_URL\`: project URL.
- \`SUPABASE_SERVICE_ROLE_KEY\`: server-only service-role key. Never expose this as a \`VITE_\` variable or send it to the browser.
- \`GUEST_RATE_LIMIT_SALT\`: optional high-entropy server-only salt for hashing the rate-limit fingerprint. If omitted, the service-role key is used as the salt.

The browser receives only a random 256-bit guest capability. The database stores its SHA-256 hash. The capability is returned once at submission and kept in the current browser session. It is not an account identity.

### Science worker (Nest environment)

- \`SUPABASE_URL\`
- \`SUPABASE_SERVICE_ROLE_KEY\`
- \`EARTHDATA_TOKEN\` (preferred), or both \`EARTHDATA_USERNAME\` and \`EARTHDATA_PASSWORD\`
- Existing worker settings such as \`PORT\`, \`SCIENCE_WORKER_POLL_SECONDS\`, and \`SCIENCE_PROCESSING_DIRECTORY\`

Earthdata credentials must remain on the worker. Do not put them in Vercel client variables, source control, or browser requests.

## Database migration order

Apply the repository's migrations in timestamp order, including:

1. \`20261117112238_sentinel2_ndvi_jobs.sql\`
2. \`20261118202000_nisar_gcov_change_jobs.sql\`
3. \`20261118203000_guest_nisar_capabilities.sql\`

The guest migration adds nullable ownership for guest rows, hashed capabilities, 24-hour expiry, rate-limit records, a service-role-only enqueue RPC, and queue-claim logic that includes eligible guest jobs. It does not grant anonymous clients direct table access.

## Request lifecycle

1. The browser selects two GCOV catalog records, a supported frequency and covariance term, and a polygon AOI.
2. The server validates the request, generates a random capability, hashes it, derives a rate-limit fingerprint from the request's client address, and calls the service-role-only database RPC.
3. The worker claims the job from the same queue used by the existing scientific worker.
4. The worker checks product compatibility and requests both Harmony subsets.
5. It calculates the aligned-grid dB difference and uploads the GeoTIFF into the private \`scientific-results\` bucket under \`guest/{job_id}/\`.
6. The browser polls using the capability. A completed result receives a short-lived signed download URL.
7. The worker periodically removes expired guest result objects and job rows, and prunes old rate-limit records.

Guest submission limits are three submissions per fingerprint per hour and one active guest job per fingerprint. Guest capabilities expire after 24 hours. A 15-minute signed download URL is refreshed when the browser requests status again.

## Validation and scientific interpretation

The current guest job does not retrieve an independent reference raster. It therefore does not calculate a flood/water classification, confusion matrix, precision, recall, IoU, calibrated confidence, or uncertainty probability. The worker's generic validation utilities are not a substitute for a reference-data integration.

A future validated water workflow must align the NISAR result with a documented independent reference such as OPERA DSWx or JRC Global Surface Water, account for acquisition timing and product maturity, document exclusions and sampling, and report class-specific validation metrics. Rainfall or hydrological context can explain conditions but cannot independently validate a water mask.

## Operational checks

- \`GET /health\` on the worker confirms the service and queue thread are running; it does not prove Earthdata authentication or a successful Harmony request.
- Run the Python worker test suite and the frontend test/lint/build workflow after changes.
- Submit a small AOI with a real compatible pair before calling the workflow live.
- Confirm the worker uploaded the expected \`guest/{job_id}/nisar-gcov-change.tif\` object and the API returns a signed URL.
- Verify cancellation, expiry, and cleanup on a non-production test job before relying on them operationally.

Do not describe a catalog result, a queued job, or a successful raster download as a validated flood detection.
