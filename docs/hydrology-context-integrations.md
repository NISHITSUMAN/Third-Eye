# Hydrology context integrations

This document describes the source products used as supporting context in Third Eye. These layers are not, by themselves, flood detections.

## JRC Global Surface Water

- Provider: European Commission Joint Research Centre (JRC), exposed in the Microsoft Planetary Computer STAC catalog as `jrc-gsw`.
- Integrated role: the `flood-water` discovery workflow searches the static historical baseline over the selected AOI.
- Temporal meaning: this catalog collection represents the long-term Landsat water record for 1984–2020. It is not a current observation and is not synchronized to the app's date filter.
- Interpretation: water occurrence, seasonality, recurrence, and historical extent describe water behaviour over a long observation record. They cannot establish that a location is flooded now or that a recent event caused a change.
- Query behaviour: the STAC search keeps the selected AOI geometry but deliberately omits the recent date-range filter for this static collection, so it is not accidentally hidden from a current investigation.
- Data access: [Planetary Computer JRC GSW collection](https://planetarycomputer.microsoft.com/api/stac/v1/collections/jrc-gsw).
- Newer source release: the official Global Surface Water portal documents the V1.5 aggregated products through 2024. Third Eye's current STAC integration does not yet process that newer release; do not label the integrated STAC result as V1.5 or 1984–2024. See [JRC Global Surface Water data access](https://global-surface-water.appspot.com/download).

## NASA GPM IMERG precipitation context

- Provider: NASA Global Precipitation Measurement (GPM), IMERG.
- Map layer: NASA Global Imagery Browse Services (GIBS), `IMERG_Precipitation_Rate`.
- Renderers: MapLibre 2D and Cesium 3D use the public EPSG:3857 GIBS tile service.
- Resolution/scale: daily browse imagery at approximately 0.1-degree source-grid spacing; the displayed quantity is precipitation rate in mm/hr.
- Time semantics: the map requests the service's default/latest available image. It is not a forecast, a daily accumulation, or a user-selected historical time-series query, and it is not synchronized with the app's timeline.
- Interpretation: rainfall can provide meteorological context for an investigation. It does not demonstrate inundation, surface-water extent, or flood damage.
- Source: [NASA GIBS WMTS](https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/).

## Scientific boundaries

1. Keep source-reported events, catalog observations, derived measurements, and screening context visibly distinct.
2. Do not combine historical JRC occurrence and daily GPM precipitation into a flood classifier without a validated method and independent reference data.
3. Do not describe a gamma0 backscatter difference or negative-backscatter screening mask as a water/flood map.
4. Record product version, acquisition time, spatial footprint, and valid-pixel coverage whenever a derived result is produced.
