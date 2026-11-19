# Third Eye backend operations

## Vercel server environment

The web application uses these server-side variables:

| Variable | Purpose | Required |
|---|---|---|
| `SUPABASE_URL` | Supabase project URL used by server routes | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key used for guest job creation, status checks, cancellation and signed private downloads | Yes |
| `GUEST_RATE_LIMIT_SALT` | Independent secret salt for browser/IP rate-limit fingerprints | Recommended |
| `SCIENCE_WORKER_URL` | HTTPS base URL of the Nest science worker, without the `/health` suffix | Yes for worker readiness checks |
| `GROQ_API_KEY` | Assistant provider key | Optional for core map/catalog use |
| `GROQ_MODEL` | Assistant model identifier | Optional for core map/catalog use |

Never prefix server secrets with `VITE_`. The service-role key and rate-limit salt must never be exposed to browser code, logs, assistant context, or downloadable provenance.

The health endpoint is `/api/health`. It checks whether the Supabase guest API is configured and probes `SCIENCE_WORKER_URL/health` with a short timeout. A worker is reported as healthy only when its health payload confirms that the worker loop is running and advertises `nisar-gcov-change`. Earthdata readiness is reported separately. A reachable old worker that advertises only Sentinel-2 is degraded, not healthy.

## Nest science worker

The worker requires:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- Either `EARTHDATA_TOKEN`, or both `EARTHDATA_USERNAME` and `EARTHDATA_PASSWORD`

The public `/health` response must advertise both supported workflows:

- `sentinel2-ndvi`
- `nisar-gcov-change`

It must also report `worker_running: true`. The health response never includes credential values.

After updating the worker on the Nest VM, verify:

```bash
curl --fail --show-error --silent https://api.krishkumar.hackclub.app/health
```

Expected fields include `ok: true`, `worker_running: true`, both workflows, and `earthdata_configured: true`.

## Supabase data boundaries

- `scientific_jobs` has RLS enabled. Signed-in users can read only their own jobs.
- `scientific_guest_rate_limits` has RLS enabled with no client policies; this intentionally denies direct browser access.
- `scientific-results` is a private bucket. Guest files are accessed only through server-issued short-lived signed URLs after bearer-capability and object-path checks.
- The worker uses the service role for queue claiming, job updates and private object storage. Do not put this key in the client bundle.

## Scientific execution verification

A successful web build or a queued job does not prove that a real NISAR acquisition pair was processed. Verify a real run by checking all of the following:

1. The guest API accepts a supported pair and returns a one-time capability.
2. The worker claims the job and advances through retrieval, validation, processing and publishing.
3. The result includes the expected GeoTIFF and preview object paths.
4. The API returns signed URLs only for those exact job-scoped paths.
5. The downloaded COG opens in a GIS reader and its CRS, transform, dimensions, nodata, AOI mask and provenance match the job.
6. The optional uncertainty COG is present only when both acquisitions contain usable aligned number-of-looks data.
7. OPERA comparison is explicitly labelled exploratory screening-proxy agreement, never flood-classifier accuracy.
8. Expired guest jobs and all fixed job-scoped outputs are removed by the worker cleanup process.

A missing worker, Earthdata credential, or Supabase server key is an infrastructure configuration failure, not a scientific no-detection result.
