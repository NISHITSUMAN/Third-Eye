"""Evaluate the NISAR negative-change screening COG against an OPERA DSWx-S1 WTR COG.

The OPERA WTR raster must be downloaded from NASA/PO.DAAC by the operator.
This script performs spatial alignment and time-window checks, then writes
exploratory agreement metrics. It does not produce a flood classification.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from science_worker.nisar.reference import (
    reference_agreement_to_dict,
    validate_against_opera_dswx_s1_wtr,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare a Third Eye screening mask with an OPERA DSWx-S1 WTR reference.")
    parser.add_argument("--candidate-mask", required=True, type=Path)
    parser.add_argument("--opera-wtr", required=True, type=Path)
    parser.add_argument("--target-acquired-at", required=True, help="NISAR after-acquisition ISO-8601 timestamp with UTC offset.")
    parser.add_argument("--reference-acquired-at", required=True, help="OPERA RTC-S1 acquisition ISO-8601 timestamp with UTC offset.")
    parser.add_argument("--maximum-gap-hours", type=float, default=72.0)
    parser.add_argument("--output", type=Path, help="Optional JSON report path.")
    args = parser.parse_args()

    report = validate_against_opera_dswx_s1_wtr(
        args.candidate_mask,
        args.opera_wtr,
        target_acquired_at=args.target_acquired_at,
        reference_acquired_at=args.reference_acquired_at,
        maximum_temporal_separation_hours=args.maximum_gap_hours,
    )
    result = reference_agreement_to_dict(report)
    rendered = json.dumps(result, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
