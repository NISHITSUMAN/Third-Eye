# Third Eye

**Explore Earth. Understand change. See the bigger picture.**

Third Eye is an Earth-observation platform built for the NASA Space Apps
Challenge. It brings satellite-observation discovery, public event
context, geographic exploration, and environmental information into one
interactive interface.

The platform is designed to make complex Earth-observation data easier
to explore and understand. Users can move between a 3D globe and a 2D
map, search for places and observations, inspect satellite-product
metadata, and use an AI assistant to investigate an area.

**Live website:** https://thirdeye.nishitsuman.online

------------------------------------------------------------------------

## Contents

-   [Overview](#overview)
-   [What Third Eye does](#what-third-eye-does)
-   [Main features](#main-features)
-   [Data sources and integrations](#data-sources-and-integrations)
-   [Understanding the data](#understanding-the-data)
-   [AI assistant](#ai-assistant)
-   [Pages](#pages)
-   [Technology](#technology)
-   [Running locally](#running-locally)
-   [Environment configuration](#environment-configuration)
-   [Data limitations](#data-limitations)
-   [Contributors](#contributors)
-   [Acknowledgements](#acknowledgements)

------------------------------------------------------------------------

## Overview

Earth is constantly changing. Satellite missions, scientific datasets,
and public monitoring systems collect information about those changes,
but the information is often spread across different platforms and can
be difficult to interpret without technical knowledge.

Third Eye aims to make that information easier to access in one place.

The platform combines an interactive Earth interface with satellite-data
discovery and an AI-assisted exploration workflow. Instead of only
showing a dataset identifier or a list of catalog records, Third Eye
aims to explain what a selected record represents, what can reasonably
be learned from it, and what additional evidence would be needed to
reach a stronger conclusion.

The goal is to help people explore questions about our planet while
being clear about the difference between an observation, a catalog
record, a public event report, and a scientific analysis.

## What Third Eye does

Third Eye provides a shared geographic workspace for exploring:

-   NISAR satellite-product catalog records and acquisition footprints.
-   Optical satellite observations available through Microsoft Planetary
    Computer.
-   Publicly reported earthquake and environmental-event information.
-   Geographic locations and areas of interest.
-   Environmental context for comparing candidate regions.
-   Explanations of satellite products, metadata, and Earth-observation
    concepts.

The platform is intended for exploration and preliminary investigation.
It does not claim that every available catalog record has been processed
into a scientific result.

## Main features

### Interactive Earth

-   Explore Earth using a 3D globe.
-   Switch to a 2D map when a flat geographic view is more useful.
-   Search for countries, regions, cities, landmarks, and coordinates.
-   Focus the map on a selected location or area of interest.
-   Inspect geographic results and available observation footprints.

### Satellite observation discovery

-   Search NASA Common Metadata Repository (CMR) for NISAR-related
    products.
-   Discover supported satellite observations through Microsoft
    Planetary Computer's STAC API.
-   Filter discovery by location and date range where supported.
-   Inspect returned records and their available metadata.
-   View supported acquisition footprints on the map when geographic
    geometry is available.

### Public event context

Third Eye can display public event information from connected providers,
including:

-   USGS earthquakes.
-   NASA EONET events.

These are reports from their respective providers. They must not be
interpreted as NISAR detections or as proof that a satellite observed
the reported event.

### Environmental comparison

The platform can retrieve environmental context for selected candidate
places where the relevant data integration is available. This can
support an initial comparison of factors such as temperature,
precipitation, and approximate elevation.

These comparisons are screening-level assessments, not validated
crop-suitability models. A reliable agricultural recommendation may also
require local soil measurements, irrigation availability, land-use
information, crop variety, and expert agronomic guidance.

### Observation details

Selecting an observation should provide two levels of information:

1.  **Plain-language explanation:** a readable summary of what the
    product or record represents, its location and time, and what a user
    can reasonably infer from it.
2.  **Technical metadata:** the original metadata, product identifiers,
    acquisition times, processing information, platform, instrument,
    spatial information, and source links when those fields are supplied
    by the provider.

The technical metadata remains available for users who want to inspect
the original record.

### Timeline

A timeline helps users explore available events and observations across
a selected date range. It should reflect the dates of actual returned
records and must not imply that data exists for dates where no records
were returned.

------------------------------------------------------------------------

## Data sources and integrations

Third Eye uses or is designed to integrate with the following data
providers.

  -----------------------------------------------------------------------------------------------------
  Provider                                              Purpose                 Important distinction
  ----------------------------------------------------- ----------------------- -----------------------
  [NASA Common Metadata Repository                      Search and discovery of CMR results are catalog
  (CMR)](https://cmr.earthdata.nasa.gov/)               NASA data collections   metadata. A matching
                                                        and granules, including record does not mean
                                                        NISAR-related products  its raster has been
                                                                                processed or
                                                                                scientifically
                                                                                interpreted.

  [NASA NISAR](https://nisar.jpl.nasa.gov/)             Mission and product     Product availability
                                                        context for the         and processing maturity
                                                        NASA-ISRO Synthetic     depend on the actual
                                                        Aperture Radar mission  mission data record.

  [Microsoft Planetary                                  STAC-based discovery of A STAC item describes
  Computer](https://planetarycomputer.microsoft.com/)   supported               an available dataset
                                                        Earth-observation       asset. It is not
                                                        datasets, including     automatically a derived
                                                        optical imagery         analysis or
                                                                                classification.

  [USGS Earthquake Hazards                              Public earthquake event Earthquake records are
  Program](https://earthquake.usgs.gov/)                information             source-reported seismic
                                                                                event data, not
                                                                                satellite detections.

  [NASA EONET](https://eonet.gsfc.nasa.gov/)            Public natural-event    EONET events are event
                                                        context                 reports and should not
                                                                                be presented as
                                                                                satellite-derived
                                                                                impact assessments.

  [Meteomatics](https://www.meteomatics.com/)           Weather context such as Availability depends on
                                                        temperature,            valid server-side
                                                        precipitation, and      credentials and API
                                                        wind, when configured   access.
  -----------------------------------------------------------------------------------------------------

### Data attribution

Data and imagery remain subject to the attribution and usage terms of
their respective providers. The application should preserve provider
attribution wherever data is displayed.

------------------------------------------------------------------------

## Understanding the data

One of the most important principles in Third Eye is to distinguish
between **finding data** and **analysing data**.

### Catalog records

A catalog record tells us that a dataset or product is listed by a
provider. It may include:

-   Product or granule identifier.
-   Acquisition start and end time.
-   Platform and instrument.
-   Processing level or product maturity, when reported.
-   Geographic footprint or bounding geometry.
-   Links to browse images, metadata, or data assets.

A catalog result does not, by itself, tell us whether a flood occurred,
how much land changed, whether a forest was damaged, or whether a
particular crop will grow successfully.

### Observations

An observation is data collected by a satellite or another instrument.
The usefulness of an observation depends on the sensor, product type,
acquisition conditions, spatial resolution, processing level, and the
question being investigated.

For example, a NISAR product may contain radar measurements or a derived
radar product. Its exact meaning depends on the product family and
processing information in the record.

### Derived analysis

A derived analysis requires processing data for a defined scientific or
practical question. Depending on the task, this may involve calibration,
preprocessing, comparison across dates, classification, change
detection, uncertainty estimation, and validation.

Third Eye must not describe raw catalog metadata as a completed
analysis. Where a workflow only discovers records, the interface and AI
assistant should say so clearly.

### Evidence and uncertainty

Third Eye should communicate:

-   Which provider supplied the information.
-   The date and geographic area covered.
-   Whether the result is a catalog record, an observation, a public
    event report, or a derived analysis.
-   What the evidence supports.
-   What it does not support.
-   Whether a result is incomplete, approximate, or unavailable.

------------------------------------------------------------------------

## AI assistant

Third Eye includes an AI assistant intended to help users explore the
platform through natural-language requests.

The assistant is designed to do more than provide conversational
answers. Depending on the tools and data integrations available, it can:

-   Search for places and coordinates.
-   Set or update the current area of interest.
-   Move and focus the globe or map.
-   Switch between 2D and 3D views.
-   Search supported satellite-data catalogs.
-   Refresh and inspect supported public event feeds.
-   Show or hide supported map layers.
-   Change the selected date range.
-   Focus a selected observation or geographic result.
-   Explain product identifiers and metadata.
-   Summarise what selected observations can and cannot establish.
-   Compare candidate regions using available environmental context.
-   Map verified candidate locations and explain the basis of a
    comparison.
-   Open relevant sections of the application.

The assistant should use tools when a request requires an application
action or data retrieval. It should not claim that an action succeeded
unless the corresponding tool or application state confirms it.

### Evidence-aware responses

The assistant should clearly distinguish between:

-   Information retrieved from a connected provider.
-   General scientific or geographic knowledge.
-   An estimate or screening-level comparison.
-   A result calculated by an implemented analysis workflow.
-   Information that is unavailable.

It should not invent satellite detections, measurements, map markers,
rankings, or provider results. If a requested analysis is not
implemented or the necessary data is unavailable, it should explain the
limitation and offer the most useful supported next step.

------------------------------------------------------------------------

## Pages

The website is organised into a public-facing experience and the main
Earth-observation workspace.

### Landing page

Introduces Third Eye, explains the project's purpose, and provides
navigation to the other public sections and the application.

### Intro

A short opening experience that introduces the project before taking
visitors to the home page.

### Learn

Explains the science and concepts behind the project, including Earth
observation, radar, NISAR, and how satellite products should be
interpreted.

### Dashboard

The main interactive workspace. It contains the globe/map, search,
layers, observation discovery, event context, timeline, observation
details, and AI assistant.

### Home, Team, and Links

Public pages intended to be accessible without requiring users to sign
in.

### Public access

The Dashboard and Learn routes are available without Google sign-in,
registration, or a Third Eye account. Legacy /login and /auth/callback
URLs redirect to the public Dashboard. The public NISAR investigation interface is implemented separately
from the legacy signed-in processing flows. Visitors can discover
NISAR acquisitions, choose a compatible GCOV pair, submit an anonymous
guest investigation, view its status, cancel it, and retrieve
time-limited result links. This guest workflow requires the server-only
Supabase service-role configuration described below and a running
science worker; public UI access alone does not make processing ready.

------------------------------------------------------------------------

## Technology

The dashboard and application are built around a web-based interactive
mapping experience. The project has been developed as a combined
application with contributions to the landing, introduction, learning,
and dashboard experiences.

The exact package versions and final dependency list should be taken
from the repository's package manifest and lockfile. The following
technologies and services are part of the project's implementation or
integrations:

-   **CesiumJS** --- 3D globe visualisation.
-   **MapLibre** --- 2D map rendering.
-   **Supabase** --- database, storage, and worker job infrastructure.
-   **NASA CMR** --- NASA data catalog discovery.
-   **Microsoft Planetary Computer STAC API** --- satellite-data
    discovery.
-   **USGS** --- earthquake event information.
-   **NASA EONET** --- public natural-event information.
-   **Meteomatics** --- optional weather context, subject to API
    configuration.

------------------------------------------------------------------------

## Running locally

The exact commands depend on the package manager and scripts defined in
the repository.

1.  Clone the repository.
2.  Install dependencies using the package manager indicated by the
    lockfile.
3.  Create a local environment file using the variable names documented
    by the application.
4.  Configure the required service credentials.
5.  Start the development server using the repository's development
    script.

Do not commit local environment files or secrets to Git.

------------------------------------------------------------------------

## Environment configuration

Some integrations require credentials or project-specific configuration.

Typical configuration areas include:

-   Supabase project URL and publishable key for public, read-only client integrations.
-   Server-only Supabase service-role credentials for trusted API/worker operations; never expose these through a VITE_ variable.
-   Cesium ion token or the configured imagery/terrain providers, if
    required by the current globe setup.
-   Server-side Meteomatics username and password, if weather context is
    enabled.
-   Any additional server-side provider credentials required by the
    current implementation.

Use the exact variable names referenced by the source code and
deployment configuration. Do not expose private credentials in
client-side variables, screenshots, logs, documentation, or commits.

## Data and scientific processing status

### Implemented in the current source tree

- Public Dashboard and Learn routes; Google sign-in is not required.
- Cesium 3D globe and MapLibre 2D map, with NASA CMR NISAR discovery and
  observation/context layers.
- Guest NISAR GCOV investigation UI and server API:
  `POST /api/science/jobs`, `GET /api/science/jobs/:id`, and
  `DELETE /api/science/jobs/:id`.
- Guest access uses a random bearer capability. Only its SHA-256 digest is
  stored in Postgres. Guest jobs expire after 24 hours, submission is
  rate-limited, output files remain in the private
  `scientific-results` bucket, and downloads use short-lived signed URLs.
- Python worker integration for AOI-bounded NASA Harmony GCOV retrieval,
  compatible-pair checks, gamma-zero backscatter change in dB, explicit
  after-to-before grid alignment with safeguards, actual before/after
  acquisition previews, derived change COG/quicklook, and reproducibility
  manifests.
- First-order per-pixel measurement-noise diagnostics when both acquisitions
  provide aligned number-of-looks layers. This is not calibrated confidence
  or hazard probability.
- AOI-bounded JRC Global Surface Water v1.5 occurrence and Copernicus GLO-30
  DSM slope context, used only for a clearly labelled provisional
  candidate-new-open-water screen with GeoTIFF and optional GeoJSON outputs.
- Optional time-matched OPERA DSWx-S1 exploratory comparison. JRC, Copernicus,
  OPERA, and GPM context do not establish flood truth or transferable
  classifier accuracy.

### Production configuration and live verification

The guest job API intentionally returns HTTP 503 until
`SUPABASE_SERVICE_ROLE_KEY` is configured as a **server-only** Vercel
environment variable. The Python worker separately requires
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and NASA Earthdata
credentials (`EARTHDATA_TOKEN`, or both
`EARTHDATA_USERNAME` and `EARTHDATA_PASSWORD`). Never prefix these
secrets with `VITE_`, put them in browser code, or commit their values.

A successful frontend build and passing synthetic/unit tests do not prove
live NASA Harmony access or an end-to-end job. The production workflow is
not considered verified until an anonymous visitor can submit a real
compatible NISAR pair, the deployed worker downloads both acquisitions,
the outputs are uploaded, and the public UI can retrieve the outputs and
reproducible provenance. See
[`docs/nisar-guest-processing.md`](docs/nisar-guest-processing.md)
and the worker README for the operational procedure. The complete release
gate and host-side verification commands are in
[`docs/production-readiness.md`](docs/production-readiness.md).

### Scientific scope boundaries

The NISAR workflow currently reports **measured gamma-zero backscatter
change**, not a flood, water, landslide, wildfire, forest-loss, or
deformation classification. A negative-change raster is a screening
proxy only. OPERA comparison, when available, is exploratory agreement
for that AOI/date pair; it is not transferable classifier accuracy or
ground truth. JRC and GPM are contextual evidence and do not establish
that a specific event occurred.

The current GCOV pipeline rejects differing raster grids rather than
silently resampling them. It does not produce interferometric coherence,
interferograms, or validated ground-deformation measurements. Do not
describe simulations in Learn/playground content as live NISAR results.

Catalog availability and map footprints do not imply that the underlying
data has been processed or that a scientific conclusion is established.
When a provider is unavailable, a job fails, or evidence is incomplete,
the application must show that limitation rather than fabricate results.

------------------------------------------------------------------------

## Contributors

Third Eye was built by a team, with different members contributing to
different parts of the project.

  ------------------------------------------------------------------------------------------------------
  Contributor             Contribution            GitHub
  ----------------------- ----------------------- ------------------------------------------------------
  **Shayan Shaikh**       Landing page and        [@shayanSY](https://github.com/shayanSY)
                          public-facing website   

  **Nikhil Kaware**       Intro experience and    [@Nikhilkaware36](https://github.com/Nikhilkaware36)
                          Learn page              

  **Nishit Suman**        Main dashboard and the  [@NISHITSUMAN](https://github.com/NISHITSUMAN)
                          remaining application   
                          features and            
                          integrations            
  ------------------------------------------------------------------------------------------------------

Contributions, improvements, and issue reports are welcome.

------------------------------------------------------------------------

## Acknowledgements

We would like to acknowledge the teams and organisations that make
Earth-observation data and scientific resources publicly accessible,
including NASA, the NASA-ISRO NISAR mission, NASA Earthdata, the USGS,
Microsoft Planetary Computer, and the other data providers integrated
into Third Eye.

We also thank the NASA Space Apps Challenge for providing the
opportunity to build a project around Earth science and open data.

------------------------------------------------------------------------

## Project

**Third Eye**\
Live website: https://thirdeye.nishitsuman.online

Built for the NASA Space Apps Challenge.
