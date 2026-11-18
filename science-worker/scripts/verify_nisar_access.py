"""Run a real, small NASA Harmony NISAR GCOV access preflight.

Run from science-worker after installing the project:
    python scripts/verify_nisar_access.py \
      --collection-id C... --granule-id G... \
      --bounds -74.2 40.6 -73.8 40.9

Earthdata credentials are read only from the worker environment and are never
printed. The script intentionally downloads only one selected granule/AOI.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
from pathlib import Path

from science_worker.nisar.access import request_gcov_subset
from science_worker.nisar.gcov import read_gcov_cog_scene


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verify live NASA Harmony access to one NISAR GCOV subset.")
    parser.add_argument("--collection-id", default=os.getenv("NISAR_PREFLIGHT_COLLECTION_ID"))
    parser.add_argument("--granule-id", default=os.getenv("NISAR_PREFLIGHT_GRANULE_ID"))
    parser.add_argument(
        "--bounds",
        nargs=4,
        type=float,
        metavar=("WEST", "SOUTH", "EAST", "NORTH"),
        help="Small WGS84 bounding box in degrees.",
    )
    parser.add_argument("--frequency", choices=("frequencyA", "frequencyB"), default="frequencyA")
    parser.add_argument("--polarization-term", default="HHHH")
    args = parser.parse_args()
    if not args.collection_id or not args.granule_id or not args.bounds:
        parser.error("Provide --collection-id, --granule-id, and --bounds (or set the two NISAR_PREFLIGHT_* IDs).")
    return args


def main() -> int:
    args = parse_args()
    bounds = tuple(args.bounds)
    token_configured = bool(os.getenv("EARTHDATA_TOKEN", "").strip())
    password_configured = bool(os.getenv("EARTHDATA_USERNAME", "").strip() and os.getenv("EARTHDATA_PASSWORD", ""))
    if not token_configured and not password_configured:
        raise SystemExit("Earthdata credentials are not configured in this worker environment.")

    with tempfile.TemporaryDirectory(prefix="third-eye-nisar-preflight-") as directory:
        outputs = request_gcov_subset(
            collection_concept_id=args.collection_id,
            granule_concept_id=args.granule_id,
            bounds=bounds,
            frequency=args.frequency,
            polarization_term=args.polarization_term,
            output_directory=Path(directory),
        )
        layer_pattern = re.compile(
            rf"(?:^|[_-]){re.escape(args.polarization_term)}(?:[_\\.-]|$)",
            re.IGNORECASE,
        )
        power_paths = [path for path in outputs if layer_pattern.search(path.name)]
        if len(power_paths) != 1:
            raise SystemExit(
                "Harmony returned a response, but exactly one requested power layer could not be identified. "
                f"Returned files: {[path.name for path in outputs]}"
            )
        looks_paths = [path for path in outputs if re.search(r"(?:^|[_-])numberOfLooks(?:[_\\.-]|$)", path.name, re.IGNORECASE)]
        mask_paths = [path for path in outputs if re.search(r"(?:^|[_-])mask(?:[_\\.-]|$)", path.name, re.IGNORECASE)]
        scene = read_gcov_cog_scene(
            power_paths[0],
            frequency=args.frequency,
            polarization_term=args.polarization_term,
            number_of_looks_path=looks_paths[0] if len(looks_paths) == 1 else None,
            mask_path=mask_paths[0] if len(mask_paths) == 1 else None,
            source_id=args.granule_id,
        )
        result = {
            "success": True,
            "service": "NASA Harmony NISAR GCOV",
            "authentication_configured": True,
            "collection_concept_id": args.collection_id,
            "granule_concept_id": args.granule_id,
            "bounds_wgs84": list(bounds),
            "frequency": args.frequency,
            "polarization_term": args.polarization_term,
            "returned_file_count": len(outputs),
            "returned_files": [{"name": path.name, "bytes": path.stat().st_size} for path in outputs],
            "power_layer_crs": scene.crs.to_string(),
            "power_layer_shape": list(scene.power.shape),
            "valid_pixels": int(scene.valid_mask.sum()),
            "number_of_looks_available": scene.number_of_looks is not None,
            "note": "This verifies access and raster readability for one acquisition only; it does not verify pair alignment or scientific validity.",
        }
        print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
