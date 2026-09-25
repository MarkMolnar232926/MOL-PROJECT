"""Print a parsed preview of the input.

python -m recon.preview WORKBOOK.xlsx
python -m recon.preview PHYSICAL.xlsx SAP.xlsx
"""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

import pandas as pd

from .errors import ReconError
from .loader import InputFile, load_inputs
from .normalize import normalize

PHYSICAL_COLS = [
    "excel_row",
    "asset_id",
    "item_name",
    "color",
    "width_cm",
    "size_word",
    "building",
    "activation_date",
    "status",
]
SAP_COLS = [
    "excel_row",
    "item_name",
    "color",
    "width_cm",
    "serial_no",
    "serial_year",
    "qr_code",
    "building",
]


def main(argv: list[str]) -> int:
    if len(argv) not in (1, 2):
        print(__doc__)
        return 2
    roles = [None] if len(argv) == 1 else ["physical", "sap"]
    files = [
        InputFile(Path(p).name, Path(p).read_bytes(), r) for p, r in zip(argv, roles, strict=True)
    ]
    try:
        loaded = load_inputs(files)
    except ReconError as exc:
        print(f"ERROR [{exc.code}]: {exc.message}")
        return 1
    data = normalize(loaded)

    for sheet in (loaded.physical, loaded.sap):
        print(
            f"{sheet.source:8s} <- '{sheet.file_name}' › '{sheet.sheet_name}' "
            f"(by {sheet.detected_by}), {sheet.row_count} rows, "
            f"missing optional: {sheet.missing_optional or 'none'}"
        )
    for w in loaded.warnings:
        print("WARNING:", w.text)

    with pd.option_context("display.width", 200, "display.max_columns", 20):
        print("\nPhysical_Inventory (first 10):")
        print(data.physical[PHYSICAL_COLS].head(10).to_string(index=False))
        print("\nSAP_Export (first 10):")
        print(data.sap[SAP_COLS].head(10).to_string(index=False))

    print("\nPhysical item names:", dict(Counter(data.physical["item_name"])))
    print("Physical statuses:", dict(Counter(data.physical["status"])))
    print(
        "Descriptions with width:",
        int(data.physical["width_cm"].notna().sum()),
        "| with small/large:",
        int(data.physical["size_word"].notna().sum()),
    )
    print(f"\nNormalisation issues: {len(data.issues)}")
    for issue in data.issues[:20]:
        print(f"  {issue.source} row {issue.excel_row}: [{issue.code}] {issue.message}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
