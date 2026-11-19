# Third Eye production-readiness runbook

Last audited: 2026-11-19

This document separates source-code implementation from live operational
verification. Do not mark the NISAR workflow production-ready merely
because the frontend builds or unit tests pass.

## Current verified state

- The current `main` source tree contains the anonymous NISAR guest API,
  NISAR investigation UI, worker processing path, assistant actions,
  guest-capability migration, and private result-download flow.
- The current `main` and `feat/complete-science-platform` branch tips
  were checked and had identical Git tree hashes during this audit.
- GitHub Actions web tests, lint, production build, and Python
  science-worker tests passed for the audited source.
- A Vercel preview build completed and verified the Cesium runtime assets.
- The live Supabase project contains the job schema and private
  `scientific-results` bucket.
- The database contained Sentinel-2 jobs but no NISAR jobs at audit time.

## Current release blockers

1. **Vercel server configuration:** the primary Vercel project's
   environment-variable list did not contain
   `SUPABASE_SERVICE_ROLE_KEY`. Without it, `POST /api/science/jobs`
   intentionally returns HTTP 503. This key must be stored only as a
   sensitive/server-only variable. Never use a `VITE_` name.
2. **Worker runtime:** the Nest/VM worker process, its deployed revision,
   service health, and actual queue consumption were not verifiable
   through the connected GitHub, Vercel, or Supabase tools. Verify them
   from the host using the commands below.
3. **NASA live access:** synthetic worker tests do not prove Earthdata
   authentication or a real NASA Harmony download. A real single-scene
   preflight and then a real two-scene job are required.
4. **Production deployment:** the custom domain was assigned to a READY
   production deployment, but that deployment referenced an older
   `main` commit than the audited source. Promote only after the
   production configuration is present and the live smoke tests pass.
5. **Vercel CI status:** the GitHub status contexts reported Vercel
   build-rate-limit failures for the connected Vercel projects. GitHub
   Actions tests themselves passed. The duplicate Vercel project should
   be reviewed so it does not consume builds or create misleading failing
   deployment checks.

## Required environment configuration

### Vercel application project

Set these in Vercel Project Settings → Environment Variables for the
primary `third-eye` project:

| Variable | Environments | Purpose |
|---|---|---|
| `SUPABASE_URL` | Preview, Production | Server-side Supabase URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Preview, Production | Privileged API access for guest enqueue/status/cancel and signed downloads |
| `GUEST_RATE_LIMIT_SALT` | Preview, Production | Independent random secret used to hash rate-limit fingerprints |
| `GROQ_API_KEY` | Preview, Production | Assistant provider |
| `GROQ_MODEL` | Preview, Production | Assistant model name |

The service-role key and rate-limit salt must be stored as encrypted or
sensitive values. Use the service-role/secret API key from the Supabase
project settings. Do not paste it into chat, GitHub, issue trackers,
logs, browser storage, or a `VITE_` variable.

The following variables are public client configuration and may use
the `VITE_` prefix:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_CESIUM_ION_IMAGERY_ASSET_ID`
- `VITE_CESIUM_TERRAIN`
- `VITE_PROJECT_REPOSITORY_URL`

Do not put Earthdata credentials in the Vercel browser-facing app.

### Python worker host

The long-running worker requires:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `EARTHDATA_TOKEN`, or both `EARTHDATA_USERNAME` and
  `EARTHDATA_PASSWORD`
- `PORT=8000` unless the host provides a different port

The key must be the same Supabase project's service-role secret used by
the API. Store it in the host's secret manager or systemd EnvironmentFile,
not in the repository.

## Host-side verification

Run these on the Nest/VM host from the worker checkout. They display
only whether credentials are present, never their values:

```bash
cd ~/Third-Eye/science-worker

.venv/bin/python - <<'PY'
import os
required = (
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
)
for name in required:
    print(f"{name}: {'SET' if os.getenv(name, '').strip() else 'MISSING'}")
earthdata = bool(os.getenv("EARTHDATA_TOKEN", "").strip()) or (
    bool(os.getenv("EARTHDATA_USERNAME", "").strip())
    and bool(os.getenv("EARTHDATA_PASSWORD", ""))
)
print(f"EARTHDATA credentials: {'SET' if earthdata else 'MISSING'}")
PY

systemctl --user status third-eye-science-worker --no-pager
curl --fail --show-error http://127.0.0.1:8000/health
.venv/bin/python -m pytest -q
```

The worker health endpoint should return HTTP 200, report
`worker_running: true`, list both `sentinel2-ndvi` and
`nisar-gcov-change`, and report `earthdata_configured: true`. A 200
health response proves process liveness and configuration presence; it
does not by itself prove a Harmony download.

### Live NASA Harmony preflight

Choose a real, currently available CMR collection/granule pair with a
small AOI (the requested bounds are WGS84). Run from
`science-worker`:

```bash
.venv/bin/python scripts/verify_nisar_access.py \
  --collection-id 'C_COLLECTION_CONCEPT_ID' \
  --granule-id 'G_GRANULE_CONCEPT_ID' \
  --bounds WEST SOUTH EAST NORTH \
  --frequency frequencyA \
  --polarization-term HHHH
```

The script should report `"success": true`, a readable power-layer
shape/CRS, and non-zero valid pixels. Then run it against a second
compatible acquisition. Preflight success for one acquisition is not a
pair-compatibility result; the application/worker still must verify the
selected pair.

## End-to-end acceptance test

After setting the Vercel variables and confirming the worker:

1. Deploy the audited source to the primary Vercel project and verify
   `https://thirdeye.nishitsuman.online/api/health` responds without
   server errors.
2. Open the public Dashboard and Learn page in a private browser window;
   no Google login or Third Eye account should be required.
3. Select a small Polygon AOI, discover real NISAR GCOV acquisitions,
   and choose a compatible chronological pair with the same supported
   frequency/polarization.
4. Submit the guest investigation. The response should create a job and
   a bearer capability; do not log or share that capability.
5. Confirm the worker claims the row and advances through
   `discovering`, `retrieving`, `validating`, `processing`, and
   `publishing`.
6. Confirm the row reaches `completed`, the COG/preview/screening
   outputs exist in the private bucket, the UI can render the preview,
   and the signed downloads work.
7. Confirm JSON provenance, CSV summary, and PDF exports are usable and
   accurately label the measurement as backscatter change.
8. Test cancellation, expired capabilities, invalid tokens, rate limits,
   worker restart/recovery, missing Earthdata credentials, missing
   Supabase credentials, and a deliberately incompatible acquisition
   pair.
9. Confirm expired guest rows and files are removed by the worker cleanup
   process.

## Scientific acceptance boundaries

The current GCOV output is measured after-minus-before gamma-zero
backscatter change in dB. A negative-change screening mask is not a flood
map. The optional OPERA comparison is exploratory agreement of that
screening proxy, not flood-classifier accuracy.

The current worker does not produce interferometric coherence,
interferograms, or validated deformation. It rejects non-identical
raster grids instead of silently resampling. Flood extent, slope filtering,
permanent-water exclusion in a classifier, connected-component filtering,
minimum mapping unit, calibrated thresholds, and full classification
validation are not implemented in the current GCOV workflow.

Do not remove these limitations from reports or UI labels until the
corresponding algorithms, reference datasets, scientific evaluation,
and regression tests actually exist.

## Release gate

Do not announce production readiness until all three are true:

- CI and the production deployment build are green for the exact source
  deployed to the custom domain.
- Vercel API configuration and the remote worker's health/configuration
  are verified.
- At least one real anonymous NISAR two-acquisition job has completed
  through the UI with downloadable, provenance-backed outputs.

A passing unit test suite and a READY Vercel deployment are necessary,
but neither is a substitute for the live acceptance test.
