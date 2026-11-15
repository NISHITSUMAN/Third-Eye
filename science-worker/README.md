# Scientific processing worker

This is the first raster-processing workflow, separate from the Vercel dashboard runtime:

**Sentinel-2 L2A single-date NDVI for a user-selected polygon AOI.**

The worker claims authenticated jobs from the existing Supabase Postgres project, re-fetches the allowlisted Microsoft Planetary Computer STAC item, SAS-signs its public COG assets, reads only the AOI's 10 m B04/B08 windows plus the SCL quality window, and publishes a clipped Cloud-Optimized GeoTIFF and a transparent map preview to the private `scientific-results` bucket. Job state and provenance remain in Postgres. Redis, PostGIS, TiTiler, Earthdata credentials, and a second database are not needed for this first workflow.

## Science and evidence boundary

NDVI is calculated from Sentinel-2 Level-2A bottom-of-atmosphere reflectance:

```text
NDVI = (B08 reflectance - B04 reflectance) / (B08 reflectance + B04 reflectance)
reflectance = (digital number + per-band BOA_ADD_OFFSET) / BOA_QUANTIFICATION_VALUE
```

The worker reads `BOA_QUANTIFICATION_VALUE` and the B04/B08 band offsets from that item's `product-metadata` XML; missing calibration metadata fails the job rather than assuming offsets. B04 and B08 must share a verified 10 m CRS/grid. SCL classes 0 (no data), 1 (saturated/defective), 3 (cloud shadow), 7 (unclassified), 8/9 (cloud probability), 10 (cirrus), and 11 (snow/ice) are masked. Pixels outside the AOI, source nodata, invalid denominators, and NDVI outside [-1, 1] are also excluded.

The result is a single-date derived vegetation-index raster and descriptive pixel statistics. It is not a temporal change result, crop-health diagnosis, crop type, yield estimate, drought finding, or validated agricultural assessment. Scene classification, atmospheric correction, haze, soil background, illumination, and season can affect interpretation. This workflow does not emit confidence values or claim that a detected event occurred.

Requests are limited to Sentinel-2 L2A, polygon/multipolygon AOIs, 10,000 vertices, and four million output pixels. Source COG reads use HTTP range access; the worker does not download full global scenes. Per-user outputs are private and available only for completed jobs owned by that user.

## Local setup

Apply the SQL migration in `../supabase/migrations/` to the Supabase project used by the dashboard. The dashboard uses its existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` plus the signed-in user's session. The worker requires a server-side Supabase service-role key; never put it in a `VITE_` variable or commit it.

Install the service and run it from this directory:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[test]"
$env:SUPABASE_URL = "https://your-project-ref.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "server-only-service-role-key"
python -m science_worker.worker
```

Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as secrets in a long-running Python container/worker deployment. Set `PORT` if the host supplies a different HTTP port. The `/health` endpoint reports readiness and worker liveness without exposing configuration values. The worker can use a small container with Python 3.12/3.13; Rasterio wheels include GDAL. No raw-data credentials are required for Planetary Computer's public Sentinel-2 items; the worker obtains short-lived SAS access tokens from the provider.

The current Vercel app does not run the worker. Deploying/configuring this Python process is required before newly submitted jobs can leave the queued state.

## Tests

```powershell
python -m pytest
```

Unit tests use small synthetic arrays only to verify the formula, offsets, QA mask, and validation; they do not represent observations or produce application findings. A separate live smoke check should use an actual Planetary Computer STAC item and confirm that B04/B08/SCL range reads and output statistics complete before advertising the worker as deployed.
