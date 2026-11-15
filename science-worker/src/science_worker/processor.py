from __future__ import annotations

import math
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

import httpx
import numpy as np
import planetary_computer
import rasterio
from PIL import Image
from rasterio.errors import WindowError
from rasterio.features import geometry_mask, geometry_window
from rasterio.shutil import copy as copy_raster
from rasterio.transform import array_bounds
from rasterio.warp import Resampling, calculate_default_transform, reproject, transform_bounds, transform_geom

COLLECTION_ID = "sentinel-2-l2a"
STAC_ITEM_URL = "https://planetarycomputer.microsoft.com/api/stac/v1/collections/sentinel-2-l2a/items/{item_id}"
MAX_AOI_BYTES = 100_000
MAX_AOI_VERTICES = 10_000
MAX_NDVI_PIXELS = 4_000_000
MAX_PRODUCT_METADATA_BYTES = 2_000_000
OUTPUT_NODATA = -9999.0
INVALID_SCL_CLASSES = (0, 1, 3, 7, 8, 9, 10, 11)
ITEM_ID = re.compile(r"^[A-Za-z0-9._:-]{1,200}$")
STAC_ITEM_PREFIX = "https://planetarycomputer.microsoft.com/api/stac/v1/collections/sentinel-2-l2a/items/"
COLOR_STOPS = np.array([-1.0, -0.2, 0.0, 0.2, 0.4, 0.6, 0.8, 1.0], dtype=np.float32)
COLOR_VALUES = np.array(
    [
        [100, 54, 145],
        [220, 57, 57],
        [240, 151, 59],
        [241, 220, 81],
        [172, 202, 75],
        [85, 170, 73],
        [35, 122, 57],
        [13, 79, 45],
    ],
    dtype=np.float32,
)


class ProcessingError(Exception):
    def __init__(self, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable


class ProcessingCancelled(Exception):
    pass


@dataclass(frozen=True)
class Radiometry:
    quantification: float
    red_offset: float
    nir_offset: float


@dataclass(frozen=True)
class ProcessingOutput:
    raster_path: Path
    preview_path: Path
    bounds: tuple[float, float, float, float]
    summary: dict[str, Any]
    provenance: dict[str, Any]


def compute_ndvi(
    red_dn: np.ndarray,
    nir_dn: np.ndarray,
    scl: np.ndarray,
    *,
    radiometry: Radiometry,
    aoi_mask: np.ndarray,
    red_valid: np.ndarray,
    nir_valid: np.ndarray,
    scl_valid: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    if red_dn.shape != nir_dn.shape or red_dn.shape != scl.shape or red_dn.shape != aoi_mask.shape:
        raise ProcessingError("The Sentinel-2 bands do not align on a common pixel grid.")
    if radiometry.quantification <= 0 or not math.isfinite(radiometry.quantification):
        raise ProcessingError("The Sentinel-2 product has invalid BOA quantification metadata.")

    red = (red_dn.astype(np.float32) + radiometry.red_offset) / radiometry.quantification
    nir = (nir_dn.astype(np.float32) + radiometry.nir_offset) / radiometry.quantification
    denominator = nir + red
    ndvi = np.full(red.shape, OUTPUT_NODATA, dtype=np.float32)
    valid = (
        aoi_mask
        & red_valid
        & nir_valid
        & scl_valid
        & ~np.isin(scl, INVALID_SCL_CLASSES)
        & np.isfinite(denominator)
        & (np.abs(denominator) > 1e-6)
    )
    values = np.zeros(red.shape, dtype=np.float32)
    np.divide(nir - red, denominator, out=values, where=valid)
    valid &= np.isfinite(values) & (values >= -1.0) & (values <= 1.0)
    ndvi[valid] = values[valid]
    if not valid.any():
        raise ProcessingError("No valid clear Sentinel-2 pixels remain inside the selected area.")
    return ndvi, valid


def parse_radiometry_metadata(xml_content: bytes) -> Radiometry:
    if len(xml_content) > MAX_PRODUCT_METADATA_BYTES:
        raise ProcessingError("The Sentinel-2 product metadata file exceeds the supported size.")
    try:
        root = ET.fromstring(xml_content)
    except ET.ParseError as error:
        raise ProcessingError("The Sentinel-2 product metadata XML is invalid.") from error

    quantification: float | None = None
    offsets: dict[int, float] = {}
    for element in root.iter():
        name = element.tag.rsplit("}", 1)[-1]
        if name == "BOA_QUANTIFICATION_VALUE" and element.text:
            quantification = float(element.text)
        elif name == "BOA_ADD_OFFSET" and element.text:
            band_id = element.attrib.get("band_id")
            if band_id is not None:
                offsets[int(band_id)] = float(element.text)

    if quantification is None or not math.isfinite(quantification) or quantification <= 0:
        raise ProcessingError("The Sentinel-2 product does not report a valid BOA quantification value.")
    if 3 not in offsets or 7 not in offsets:
        raise ProcessingError("The Sentinel-2 product does not report BOA offsets for bands B04 and B08.")
    if not math.isfinite(offsets[3]) or not math.isfinite(offsets[7]):
        raise ProcessingError("The Sentinel-2 product reports invalid BOA band offsets.")
    return Radiometry(quantification, offsets[3], offsets[7])


def _validate_geometry(geometry: Any) -> dict[str, Any]:
    if not isinstance(geometry, dict) or geometry.get("type") not in {"Polygon", "MultiPolygon"}:
        raise ProcessingError("Choose a polygon or multipolygon area of interest.")
    if len(str(geometry).encode("utf-8")) > MAX_AOI_BYTES:
        raise ProcessingError("The selected area has too many coordinates.")

    vertices = 0
    longitudes: list[float] = []

    def visit(value: Any) -> None:
        nonlocal vertices
        if not isinstance(value, list) or not value:
            raise ProcessingError("The selected area contains invalid coordinates.")
        if isinstance(value[0], (int, float)):
            if len(value) < 2:
                raise ProcessingError("Each area coordinate must include longitude and latitude.")
            longitude, latitude = value[0], value[1]
            if (
                not isinstance(longitude, (int, float))
                or not isinstance(latitude, (int, float))
                or not math.isfinite(longitude)
                or not math.isfinite(latitude)
                or abs(longitude) > 180
                or abs(latitude) > 90
            ):
                raise ProcessingError("The selected area contains coordinates outside valid longitude and latitude ranges.")
            vertices += 1
            longitudes.append(float(longitude))
            if vertices > MAX_AOI_VERTICES:
                raise ProcessingError("The selected area exceeds the 10,000-vertex limit.")
            return
        for child in value:
            visit(child)

    visit(geometry.get("coordinates"))
    if not vertices:
        raise ProcessingError("The selected area contains no coordinates.")
    if longitudes and max(longitudes) - min(longitudes) > 180:
        raise ProcessingError("Antimeridian-crossing areas are not supported by this workflow.")
    return geometry


def _fetch_item(client: httpx.Client, item_id: str) -> dict[str, Any]:
    if not ITEM_ID.fullmatch(item_id):
        raise ProcessingError("The selected Sentinel-2 item ID is invalid.")
    try:
        response = client.get(STAC_ITEM_URL.format(item_id=item_id))
    except httpx.HTTPError as error:
        raise ProcessingError("The Planetary Computer item request failed.", retryable=True) from error
    if response.status_code == 429 or response.status_code >= 500:
        raise ProcessingError(
            f"Planetary Computer temporarily returned HTTP {response.status_code}.",
            retryable=True,
        )
    if response.status_code != 200:
        raise ProcessingError(f"Planetary Computer returned HTTP {response.status_code} for this item.")
    try:
        item = response.json()
    except ValueError as error:
        raise ProcessingError("Planetary Computer returned invalid item metadata.") from error
    if (
        not isinstance(item, dict)
        or item.get("type") != "Feature"
        or item.get("collection") != COLLECTION_ID
        or item.get("id") != item_id
        or not isinstance(item.get("assets"), dict)
        or not isinstance(item.get("properties"), dict)
    ):
        raise ProcessingError("The selected item is not a verifiable Sentinel-2 L2A catalog record.")
    return item


def _safe_asset_href(item: dict[str, Any], key: str) -> str:
    asset = item["assets"].get(key)
    if not isinstance(asset, dict) or not isinstance(asset.get("href"), str):
        raise ProcessingError(f"The Sentinel-2 item does not publish the required {key} asset.")
    parsed = urlparse(asset["href"])
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or not parsed.hostname.endswith(".blob.core.windows.net")
        or parsed.username
        or parsed.password
    ):
        raise ProcessingError(f"The Sentinel-2 {key} asset does not use a supported public storage host.")
    return asset["href"]


def _signed_asset_href(href: str) -> str:
    try:
        signed = planetary_computer.sign_url(href)
    except Exception as error:
        raise ProcessingError("Planetary Computer could not sign a Sentinel-2 source asset.", retryable=True) from error
    parsed = urlparse(signed)
    if parsed.scheme != "https" or not parsed.query or not parsed.hostname.endswith(".blob.core.windows.net"):
        raise ProcessingError("Planetary Computer returned an invalid signed asset URL.")
    return signed


def _fetch_product_metadata(client: httpx.Client, href: str) -> tuple[bytes, Radiometry]:
    signed_href = _signed_asset_href(href)
    try:
        with client.stream("GET", signed_href) as response:
            if response.status_code == 429 or response.status_code >= 500:
                raise ProcessingError(
                    f"Planetary Computer temporarily returned HTTP {response.status_code} for product metadata.",
                    retryable=True,
                )
            if response.status_code != 200:
                raise ProcessingError(f"Planetary Computer returned HTTP {response.status_code} for product metadata.")
            length = response.headers.get("content-length")
            if length and int(length) > MAX_PRODUCT_METADATA_BYTES:
                raise ProcessingError("The Sentinel-2 product metadata file exceeds the supported size.")
            chunks: list[bytes] = []
            size = 0
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > MAX_PRODUCT_METADATA_BYTES:
                    raise ProcessingError("The Sentinel-2 product metadata file exceeds the supported size.")
                chunks.append(chunk)
    except httpx.HTTPError as error:
        raise ProcessingError("The Sentinel-2 product metadata could not be retrieved.", retryable=True) from error
    content = b"".join(chunks)
    return content, parse_radiometry_metadata(content)


def _valid_pixel_size(transform: rasterio.Affine) -> float:
    x_size = abs(transform.a)
    y_size = abs(transform.e)
    if (
        not math.isfinite(x_size)
        or not math.isfinite(y_size)
        or not math.isclose(x_size, 10.0, abs_tol=0.01)
        or not math.isclose(y_size, 10.0, abs_tol=0.01)
        or abs(x_size - y_size) > 0.01
    ):
        raise ProcessingError("The Sentinel-2 red and near-infrared rasters do not have a supported 10 m grid.")
    return (x_size + y_size) / 2


def _write_geotiff(
    path: Path,
    values: np.ndarray,
    transform: rasterio.Affine,
    crs: rasterio.crs.CRS,
    tags: dict[str, str],
) -> None:
    temporary_path = path.with_suffix(".source.tif")
    height, width = values.shape
    profile = {
        "driver": "GTiff",
        "height": height,
        "width": width,
        "count": 1,
        "dtype": "float32",
        "crs": crs,
        "transform": transform,
        "nodata": OUTPUT_NODATA,
        "compress": "deflate",
        "predictor": 3,
        "tiled": True,
        "blockxsize": 256,
        "blockysize": 256,
    }
    with rasterio.open(temporary_path, "w", **profile) as output:
        output.write(values, 1)
        output.update_tags(
            1,
            STATISTICS_UNIT="unitless",
            **tags,
        )
        output.update_tags(
            AREA_OR_POINT="Area",
            PROCESSING_ALGORITHM="Sentinel-2 L2A BOA-corrected NDVI",
            PROCESSING_SOFTWARE="Third Eye Rasterio worker",
        )
    try:
        copy_raster(
            temporary_path,
            path,
            driver="COG",
            compress="DEFLATE",
            predictor="FLOATING_POINT",
            blocksize=512,
            overview_resampling="AVERAGE",
        )
    finally:
        temporary_path.unlink(missing_ok=True)


def _write_preview(
    path: Path,
    values: np.ndarray,
    transform: rasterio.Affine,
    crs: rasterio.crs.CRS,
) -> tuple[float, float, float, float]:
    bounds = transform_bounds(crs, "EPSG:4326", *array_bounds(values.shape[0], values.shape[1], transform), densify_pts=21)
    west, south, east, north = bounds
    if not all(math.isfinite(value) for value in bounds) or west >= east or south >= north:
        raise ProcessingError("The processed raster does not have valid geographic bounds.")

    height, width = values.shape
    scale = min(512 / width, 512 / height, 1.0)
    preview_width = max(1, int(math.ceil(width * scale)))
    preview_height = max(1, int(math.ceil(height * scale)))
    preview_transform, _, _ = calculate_default_transform(
        crs,
        "EPSG:4326",
        width,
        height,
        *array_bounds(height, width, transform),
        dst_width=preview_width,
        dst_height=preview_height,
    )
    preview = np.full((preview_height, preview_width), OUTPUT_NODATA, dtype=np.float32)
    reproject(
        source=values,
        destination=preview,
        src_transform=transform,
        src_crs=crs,
        src_nodata=OUTPUT_NODATA,
        dst_transform=preview_transform,
        dst_crs="EPSG:4326",
        dst_nodata=OUTPUT_NODATA,
        resampling=Resampling.bilinear,
    )

    valid = np.isfinite(preview) & (preview != OUTPUT_NODATA)
    safe_values = np.where(valid, np.clip(preview, -1.0, 1.0), -1.0)
    upper = np.clip(np.searchsorted(COLOR_STOPS, safe_values, side="right") - 1, 0, len(COLOR_STOPS) - 2)
    lower_value = COLOR_STOPS[upper]
    upper_value = COLOR_STOPS[upper + 1]
    fraction = np.clip((safe_values - lower_value) / (upper_value - lower_value), 0, 1)[..., None]
    rgb = np.rint(COLOR_VALUES[upper] * (1 - fraction) + COLOR_VALUES[upper + 1] * fraction).astype(np.uint8)
    rgba = np.dstack((rgb, np.where(valid, 255, 0).astype(np.uint8)))
    Image.fromarray(rgba, mode="RGBA").save(path, format="PNG", optimize=True)
    return west, south, east, north


def process_sentinel2_ndvi(
    item_id: str,
    aoi_geojson: Any,
    output_directory: Path,
    *,
    progress: Callable[[str], None] | None = None,
    cancelled: Callable[[], bool] | None = None,
) -> ProcessingOutput:
    def report(stage: str) -> None:
        if cancelled and cancelled():
            raise ProcessingCancelled()
        if progress:
            progress(stage)

    geometry = _validate_geometry(aoi_geojson)
    output_directory.mkdir(parents=True, exist_ok=True)
    report("discovering")
    try:
        with httpx.Client(timeout=httpx.Timeout(30.0, connect=10.0), follow_redirects=False) as client:
            item = _fetch_item(client, item_id)
            properties = item["properties"]
            acquired = properties.get("datetime") or properties.get("start_datetime")
            if not isinstance(acquired, str):
                raise ProcessingError("The selected Sentinel-2 item does not report an acquisition time.")
            try:
                acquired_at = datetime.fromisoformat(acquired.replace("Z", "+00:00")).astimezone(timezone.utc)
            except ValueError as error:
                raise ProcessingError("The selected Sentinel-2 item reports an invalid acquisition time.") from error
            if properties.get("s2:product_type") not in (None, "S2MSI2A"):
                raise ProcessingError("The selected item is not a Sentinel-2 Level-2A surface-reflectance product.")

            asset_hrefs = {
                key: _safe_asset_href(item, key)
                for key in ("B04", "B08", "SCL", "product-metadata")
            }
            report("retrieving")
            _, radiometry = _fetch_product_metadata(client, asset_hrefs["product-metadata"])
            signed_assets = {key: _signed_asset_href(href) for key, href in asset_hrefs.items() if key != "product-metadata"}
    except ProcessingError:
        raise
    except httpx.HTTPError as error:
        raise ProcessingError("A Planetary Computer source request failed.", retryable=True) from error

    report("validating")
    try:
        with (
            rasterio.Env(
                GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
                GDAL_HTTP_MAX_RETRY="3",
                GDAL_HTTP_RETRY_DELAY="1",
                GDAL_HTTP_TIMEOUT="30",
                CPL_VSIL_CURL_CACHE_SIZE="16777216",
            ),
            rasterio.open(signed_assets["B04"]) as red_source,
            rasterio.open(signed_assets["B08"]) as nir_source,
            rasterio.open(signed_assets["SCL"]) as scl_source,
        ):
            if red_source.crs is None or nir_source.crs is None or scl_source.crs is None:
                raise ProcessingError("A Sentinel-2 raster is missing its coordinate reference system.")
            if (
                red_source.crs != nir_source.crs
                or red_source.transform != nir_source.transform
                or red_source.width != nir_source.width
                or red_source.height != nir_source.height
            ):
                raise ProcessingError("Sentinel-2 B04 and B08 must share a common georeferenced pixel grid.")
            if red_source.count != 1 or nir_source.count != 1 or scl_source.count != 1:
                raise ProcessingError("A required Sentinel-2 asset is not a single-band raster.")

            projected_geometry = transform_geom("EPSG:4326", red_source.crs, geometry, precision=6)
            try:
                window = geometry_window(red_source, [projected_geometry])
            except WindowError as error:
                raise ProcessingError("The selected area does not overlap this Sentinel-2 scene.") from error
            window = window.intersection(rasterio.windows.Window(0, 0, red_source.width, red_source.height))
            if window.width <= 0 or window.height <= 0:
                raise ProcessingError("The selected area does not overlap this Sentinel-2 scene.")
            if window.width * window.height > MAX_NDVI_PIXELS:
                raise ProcessingError(
                    "The selected area exceeds the four-million-pixel processing limit. Draw a smaller area."
                )
            pixel_size_m = _valid_pixel_size(red_source.transform)
            window_transform = red_source.window_transform(window)
            height, width = int(window.height), int(window.width)
            aoi_mask = geometry_mask(
                [projected_geometry],
                out_shape=(height, width),
                transform=window_transform,
                invert=True,
                all_touched=False,
            )
            if not aoi_mask.any():
                raise ProcessingError("The selected area contains no Sentinel-2 pixel centers at 10 m resolution.")

            red_dn = red_source.read(1, window=window)
            nir_dn = nir_source.read(1, window=window)
            red_valid = red_source.read_masks(1, window=window) > 0
            nir_valid = nir_source.read_masks(1, window=window) > 0
            scl = np.zeros((height, width), dtype=np.uint8)
            reproject(
                source=rasterio.band(scl_source, 1),
                destination=scl,
                src_transform=scl_source.transform,
                src_crs=scl_source.crs,
                src_nodata=scl_source.nodata,
                dst_transform=window_transform,
                dst_crs=red_source.crs,
                dst_nodata=0,
                resampling=Resampling.nearest,
                init_dest_nodata=True,
            )
            scl_valid = np.ones((height, width), dtype=bool)
            if scl_source.nodata is not None:
                scl_valid &= scl != scl_source.nodata
            ndvi, valid = compute_ndvi(
                red_dn,
                nir_dn,
                scl,
                radiometry=radiometry,
                aoi_mask=aoi_mask,
                red_valid=red_valid,
                nir_valid=nir_valid,
                scl_valid=scl_valid,
            )
            crs = red_source.crs
    except ProcessingError:
        raise
    except rasterio.errors.RasterioIOError as error:
        raise ProcessingError("A Sentinel-2 COG could not be read. The source may be unavailable; retry the job.", retryable=True) from error
    except (ValueError, OverflowError) as error:
        raise ProcessingError("The Sentinel-2 raster grid or selected area is invalid.") from error

    report("processing")
    values = ndvi[valid]
    total_aoi_pixels = int(aoi_mask.sum())
    valid_pixels = int(valid.sum())
    invalid_percent = 100.0 * (1 - valid_pixels / total_aoi_pixels)
    pixel_area_km2 = pixel_size_m * pixel_size_m / 1_000_000
    summary = {
        "measurement": "Sentinel-2 L2A normalized difference vegetation index",
        "unit": "unitless",
        "mean": round(float(values.mean()), 5),
        "median": round(float(np.median(values)), 5),
        "p10": round(float(np.percentile(values, 10)), 5),
        "p90": round(float(np.percentile(values, 90)), 5),
        "valid_pixels": valid_pixels,
        "area_pixels": total_aoi_pixels,
        "valid_area_km2": round(valid_pixels * pixel_area_km2, 5),
        "masked_area_percent": round(invalid_percent, 2),
        "spatial_resolution_m": round(pixel_size_m, 2),
    }
    report("publishing")
    product_timestamp = acquired_at.isoformat().replace("+00:00", "Z")
    process_timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    item_url = f"{STAC_ITEM_PREFIX}{item_id}"
    product_baseline = properties.get("s2:processing_baseline")
    tags = {
        "SOURCE": "Microsoft Planetary Computer / Sentinel-2 L2A",
        "STAC_ITEM_ID": item_id,
        "ACQUISITION_TIME": product_timestamp,
        "NDVI_FORMULA": "(B08 BOA reflectance - B04 BOA reflectance) / (B08 BOA reflectance + B04 BOA reflectance)",
        "BOA_QUANTIFICATION_VALUE": str(radiometry.quantification),
        "B04_BOA_ADD_OFFSET": str(radiometry.red_offset),
        "B08_BOA_ADD_OFFSET": str(radiometry.nir_offset),
        "SCL_EXCLUDED_CLASSES": ",".join(str(value) for value in INVALID_SCL_CLASSES),
        "PROCESSING_TIMESTAMP": process_timestamp,
    }
    raster_path = output_directory / "sentinel2-ndvi.tif"
    preview_path = output_directory / "sentinel2-ndvi-preview.png"
    _write_geotiff(raster_path, ndvi, window_transform, crs, tags)
    bounds = _write_preview(preview_path, ndvi, window_transform, crs)

    provenance = {
        "evidence_class": "derived_estimate",
        "source": "Microsoft Planetary Computer",
        "collection_id": COLLECTION_ID,
        "item_id": item_id,
        "item_url": item_url,
        "acquisition_time": product_timestamp,
        "area_of_interest_geojson": geometry,
        "input_geometry_crs": "OGC:CRS84",
        "platform": properties.get("platform"),
        "processing_baseline": product_baseline,
        "source_assets": ["B04", "B08", "SCL", "product-metadata"],
        "algorithm": "Sentinel-2 L2A BOA-corrected NDVI",
        "algorithm_version": "1.0.0",
        "formula": "(B08 reflectance - B04 reflectance) / (B08 reflectance + B04 reflectance)",
        "parameters": {
            "boa_quantification_value": radiometry.quantification,
            "b04_boa_add_offset": radiometry.red_offset,
            "b08_boa_add_offset": radiometry.nir_offset,
            "scl_excluded_classes": list(INVALID_SCL_CLASSES),
            "pixel_inclusion": "pixel center must lie inside the selected AOI",
            "area_of_interest_geojson": geometry,
            "max_processing_pixels": MAX_NDVI_PIXELS,
        },
        "quality_checks": [
            "Verified STAC collection and item identifiers.",
            "Verified B04/B08 CRS, transform, dimensions, and 10 m grid.",
            "Read BOA quantification and band offsets from the item's product-metadata XML.",
            "Masked SCL nodata, defective/saturated pixels, cloud shadow, unclassified pixels, medium/high cloud, cirrus, and snow/ice.",
            "Masked source nodata and pixels with invalid NDVI denominator or values outside [-1, 1].",
        ],
        "uncertainty": "No per-pixel uncertainty layer is supplied by this workflow; none is estimated.",
        "limitations": [
            "Single-date vegetation index only; no temporal change was calculated.",
            "NDVI is not a crop-health diagnosis, crop type, yield estimate, drought finding, or validated agricultural assessment.",
            "Atmospheric correction and scene classification are provider supplied; residual cloud, shadow, haze, soil background, illumination, and seasonal effects may remain.",
            "Cloud/shadow/snow masking uses Sentinel-2 Scene Classification Layer classes 0, 1, 3, 7, 8, 9, 10, and 11.",
        ],
        "spatial_resolution_m": round(pixel_size_m, 2),
        "bounds_wgs84": list(bounds),
        "summary": summary,
        "processed_at": process_timestamp,
    }
    report("completed")
    return ProcessingOutput(raster_path, preview_path, bounds, summary, provenance)
