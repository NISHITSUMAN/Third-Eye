# Third Eye production-readiness runbook

Last audited: 2026-11-19

This runbook distinguishes source-code implementation, CI verification, live service configuration, and real-science acceptance. A green build is not proof that a real NISAR investigation works.

## Current release candidate

- Repository: `NISHITSUMAN/Third-Eye`
- Release branch: `feat/complete-scientific-platform`
- Pull request: https://github.com/NISHITSUMAN/Third-Eye/pull/11
- Production base branch: `main`
- Production deployment must remain unchanged until the release gates below pass.

The feature branch includes the anonymous guest NISAR API, job capability model, worker integration, GCOV alignment, uncertainty diagnostics, JRC/DEM contextual screening, reproducibility manifest, before/after previews, and assistant/UI wiring. The branch has not been merged and is not yet the source running on the production custom domain.

## Verified Supabase state

The connected Supabase project is active. The following were queried directly on 2026-11-19:

- `public.scientific_jobs` and `public.scientific_guest_rate_limits` exist.
- Seven migrations are recorded, including guest NISAR, reference-time, candidate GeoJSON, and caller-scoped cancellation migrations.
- The private `scientific-results` bucket exists, allows GeoTIFF, PNG, and GeoJSON, and is limited to 50 MiB per object.
- Three historical scientific jobs exist: one completed Sentinel-2 NDVI job and two failed Sentinel-2 jobs. Their failures were clear-data/size validation outcomes, not NISAR processing failures.
- There are currently zero NISAR jobs. No real NISAR pair has been processed through the deployed worker.

The security advisor reports:
- `scientific_guest_rate_limits` has RLS enabled with no user policies. This is intentional: access is server/service-role only.
- Three SECURITY DEFINER RPCs are executable by `authenticated`: `cancel_scientific_job`, `enqueue_nisar_gcov_change_job`, and `enqueue_sentinel2_ndvi_job`. Their definitions check `auth.uid()`, scope cancellation to the caller's own job, and enforce input validation. Do not grant these to `anon` or `PUBLIC`.
- Supabase Auth leaked-password protection is disabled. Since the product no longer requires visitor login, this is not a blocker for public Dashboard/Learn access; enable it if password-based accounts are reintroduced.
- One unused `scientific_jobs_user_id_idx` index is reported as an informational performance advisory.

No database migration is required for the new preview images; they are stored as additional fixed job-scoped objects in the existing private bucket.

## GitHub Actions

The workflow contains:
- Python science-worker tests.
- Live public JRC GSW v1.5 and Copernicus GLO-30 COG smoke tests.
- Web tests, lint, and production build.
- A live Nest worker readiness probe.

The live public raster-source smoke test has passed on the release branch. Python tests have passed on recent runs before the latest before/after preview additions. The exact current head must be rechecked after the latest commit. The live Nest readiness job currently fails because the deployed VM advertises Sentinel-2 only and does not advertise `nisar-gcov-change`; the job is intentionally non-blocking for code CI so that a VM revision mismatch does not hide source-code test results. It remains a release blocker.

## Current release blockers

1. **Vercel server secret:** the primary `third-eye` project's environment-variable list does not contain `SUPABASE_SERVICE_ROLE_KEY`. Without it, the guest scientific API intentionally returns HTTP 503. Add the Supabase secret key as a sensitive/server-only value for Preview and Production. Never use a `VITE_` name and never paste the value into chat or GitHub.
2. **Nest worker revision:** the public worker health check is reachable, but the deployed process does not advertise the NISAR workflow. The worker must be updated to the release branch's code after PR #11 is merged (or a controlled release artifact is prepared). The VM must load the correct Supabase service-role secret and Earthdata credentials.
3. **Earthdata authentication:** valid `EARTHDATA_TOKEN`, or both `EARTHDATA_USERNAME` and `EARTHDATA_PASSWORD`, must be configured on the worker. The currently deployed worker health response does not report the required NISAR readiness.
4. **Real data acceptance:** there are zero NISAR jobs. A real two-acquisition job must complete and its output files, signed downloads, report manifest, and UI rendering must be checked.
5. **Exact-head preview and visual QA:** a READY preview exists for an earlier feature-branch commit, not the current head. Vercel's deployment API quota previously returned HTTP 402. A current-head preview, browser QA, and mobile viewport QA remain required after quota availability.
6. **Flagship case study:** no actual, independently evaluated NISAR case study exists yet. Do not populate a featured investigation with synthetic or invented findings.

## Required environment configuration

### Primary Vercel project

Set these in Vercel Project Settings → Environment Variables for Preview and Production:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Server-side Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service-role/secret key for guest API and signed output access |
| `GUEST_RATE_LIMIT_SALT` | Independent high-entropy server-only salt for rate-limit fingerprint hashing |
| `SCIENCE_WORKER_URL` | Worker health/readiness URL |
| `GROQ_API_KEY` | Server-side assistant provider key |
| `GROQ_MODEL` | Assistant model identifier |

Public browser variables may include `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and the documented Cesium settings. Never expose service-role, Earthdata, Groq, or rate-limit secrets through a `VITE_` variable.

### Nest Python worker

The worker EnvironmentFile must contain:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `EARTHDATA_TOKEN`, or both `EARTHDATA_USERNAME` and `EARTHDATA_PASSWORD`
- Existing runtime settings such as `PORT`, `SCIENCE_WORKER_POLL_SECONDS`, and `SCIENCE_PROCESSING_DIRECTORY`

Keep these secrets in the host's secret manager or systemd EnvironmentFile, not in the repository.

## Host-side verification

Run on the Nest/VM host after the release branch is merged and deployed. The commands report only whether secrets are present; they never print their values.

```bash
cd ~/Third-Eye/science-worker

.venv/bin/python - <<'PY'
import os
for name in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
    print(f"{name}: {'SET' if os.getenv(name, '').strip() else 'MISSING'}")
earthdata = bool(os.getenv("EARTHDATA_TOKEN", "").strip()) or (
    bool(os.getenv("EARTHDATA_USERNAME", "").strip())
    and bool(os.getenv("EARTHDATA_PASSWORD", "").strip())
)
print(f"EARTHDATA credentials: {'SET' if earthdata else 'MISSING'}")
PY

systemctl --user status third-eye-science-worker --no-pager
curl --fail --show-error http://127.0.0.1:8000/health
.venv/bin/python -m pytest -q
```

The worker health endpoint must return HTTP 200, `worker_running: true`, both `sentinel2-ndvi` and `nisar-gcov-change` in `workflows`, and `earthdata_configured: true`. A healthy endpoint proves process/configuration readiness, not successful Harmony retrieval.

## NASA Harmony preflight

Choose real CMR collection and granule IDs for a small AOI and run:

```bash
.venv/bin/python scripts/verify_nisar_access.py \
  --collection-id 'C_REAL_COLLECTION_ID' \
  --granule-id 'G_REAL_GRANULE_ID' \
  --bounds WEST SOUTH EAST NORTH \
  --frequency frequencyA \
  --polarization-term HHHH
```

Require `"success": true`, a readable power-layer shape/CRS, and non-zero valid pixels. Repeat for a second acquisition, then verify pair compatibility in the application and worker.

## End-to-end acceptance test

After the PR is merged, Vercel secrets are configured, and the VM is updated:

1. Deploy the exact audited main commit to the primary Vercel project.
2. Verify `/api/health` reports guest API and science worker readiness without exposing secrets.
3. Open Dashboard, Learn, Data, Observations, Events, Discover, Analyze, Intelligence, Timeline, and Methodology in a private browser window. Verify no login/Google redirects and that direct refresh works.
4. At desktop and mobile sizes, select a small polygon AOI and load actual NISAR GCOV records.
5. Select a compatible chronological pair and submit a guest investigation.
6. Confirm the worker advances through the processing stages and reaches `completed`.
7. Confirm the private bucket contains the change COG, before/after previews, change quicklook, screening mask, optional uncertainty COG/preview, optional candidate-water COG/GeoJSON, and report manifest.
8. Confirm the UI renders the two actual acquisition previews, derived change preview, uncertainty diagnostic when available, metrics, limitations, and reference agreement only when a valid time-matched reference exists.
9. Verify short-lived signed downloads for each published output and verify that arbitrary storage paths cannot be signed.
10. Verify PDF, CSV, and provenance JSON exports contain only measured values and actual source identifiers.
11. Test invalid/expired capabilities, rate limits, invalid AOI geometry, unsupported product IDs, incompatible pairs, missing credentials, worker restarts, cancellation, and expiry cleanup.
12. Confirm expired guest jobs and all fixed job-scoped objects are removed.

## Scientific acceptance boundaries

The primary GCOV product is after-minus-before gamma-zero backscatter change in dB. Differing grids are explicitly aligned to the before grid using documented resampling and safeguards. The optional uncertainty output is a first-order number-of-looks measurement-noise diagnostic, not calibrated confidence or hazard probability.

The optional candidate-new-open-water screen uses historical JRC occurrence, an optional Copernicus GLO-30 DSM slope proxy, a fixed exploratory negative-backscatter threshold, and connected-component filtering. It is provisional and unvalidated. JRC occurrence is not event-time flood truth; the DSM includes buildings and vegetation. OPERA DSWx-S1 agreement is exploratory for the specific AOI/date pair and must not be described as transferable flood-classifier accuracy.

The current worker does not produce interferometric coherence, interferograms, validated ground deformation, flood depth, or hazard probability. A real flagship investigation must be based on a real compatible pair and independent validation; never use synthetic fixtures as public findings.

## Release gate

Do not mark Third Eye production-ready until all are true:

- GitHub Actions Python tests, web tests, lint, and production build pass on the exact release head.
- A current-head Vercel preview is READY and passes browser/mobile QA.
- Vercel server secrets are configured and `/api/health` reports ready.
- The deployed Nest worker advertises NISAR and has Earthdata configured.
- At least one anonymous real two-acquisition NISAR job completes end to end with downloadable outputs and reproducible provenance.
- A real, independently evaluated flagship investigation is available publicly, or the project clearly states that it is not yet available.

A green unit-test suite, successful public-source COG smoke test, or READY deployment is necessary but not sufficient.
