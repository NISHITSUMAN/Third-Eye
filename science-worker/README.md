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

## NISAR GCOV processing primitives

The worker also contains a separate, tested NISAR GCOV processing path:

- `nisar/access.py` requests AOI-bounded GCOV variables from NASA Harmony using the supported NISAR customization service. It requests the selected diagonal covariance term, the GCOV mask, and `numberOfLooks`; Harmony returns individual COGs rather than the source HDF5 file.
- `nisar/gcov.py` reads either source HDF5 GCOV products or Harmony-extracted COG layers. It interprets diagonal terms as RTC gamma-zero power and converts positive values using `10 * log10(power)`. It does not reapply RTC.
- The GCOV mask is retained as source metadata because it describes the adaptive multi-looking ensemble; it is not treated as a Boolean valid/invalid mask. Raster nodata, raster masks, positive finite power, and positive finite number-of-looks values determine valid pixels.
- `nisar/pairing.py` rejects comparisons with incompatible track, direction, frame, acquisition mode, polarization, processing CRID, orbit accuracy, frequency, polarization term, or temporal separation.
- `nisar/pipeline.py` retrieves both AOI-bounded acquisitions, checks pair compatibility, requires identical CRS/transform/dimensions, calculates after-minus-before backscatter change in dB, and writes a COG with source-product provenance.

This pipeline is a scientific processing primitive, not yet a public job workflow. It is **not yet connected to the Supabase worker queue, a guest-job API, the Dashboard, AI tool execution, independent validation, water classification, or public report delivery**. Do not present it as a deployed end-to-end NISAR investigation. It deliberately fails rather than silently resampling misaligned products.

NASA's GCOV documentation describes the diagonal layers as radiometrically terrain-corrected gamma-zero power and describes the mask as averaging-ensemble information. The Harmony service extracts requested HDF5 variables as COGs and can spatially subset them. See:

- https://nisar-docs.asf.alaska.edu/gcov/
- https://nisar-docs.asf.alaska.edu/harmony/
- https://nisar-docs.asf.alaska.edu/availability-overview/

Earthdata access is server-side only. Set either `EARTHDATA_TOKEN` or both `EARTHDATA_USERNAME` and `EARTHDATA_PASSWORD` on the worker. Do not put these values in a `VITE_` variable, source file, or public API response. Direct AWS S3 access is not used by this implementation; the documented Harmony HTTPS service is used instead.

### NISAR processing tests

```bash
python -m pytest -q tests/test_nisar_access.py tests/test_nisar_gcov.py tests/test_nisar_pairing.py tests/test_nisar_harmony_cog.py tests/test_nisar_pipeline.py
```

The NISAR tests use synthetic HDF5/GeoTIFF fixtures and a fake Harmony client. They verify the numerical and validation logic only; they do not establish that live Earthdata credentials, current CMR products, or a production Harmony download have been tested.

### Validation utilities (not yet wired into NISAR jobs)

`nisar/validation.py` provides two bounded primitives: binary confusion-matrix metrics (precision, recall, F1, IoU) against a caller-supplied, already aligned independent reference, and negative-backscatter threshold sensitivity counts. They refuse empty or mismatched evaluation coverage. They do not retrieve OPERA DSWx, JRC Global Surface Water, GPM IMERG, or any other reference dataset, and they do not create a flood classification or confidence score. A real validation report still requires independently sourced and temporally appropriate reference data plus a documented matching/calibration strategy.
