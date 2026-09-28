"""Split the practice workbook into the two upload fixtures used by the tests.

    python scripts/make_fixtures.py

writes tests/fixtures/original.xlsx (the Physical_Inventory sheet only) and
tests/fixtures/incoming.xlsx (the SAP_Export sheet only). Formatting of the kept sheet is
preserved; the other sheets (Task, the hidden Answer_Key) are removed.
"""

from __future__ import annotations

import sys
from pathlib import Path

from openpyxl import load_workbook

FIXTURES = Path(__file__).resolve().parents[2] / "tests" / "fixtures"
PRACTICE = FIXTURES / "Inventory_Reconciliation_Practice_1.xlsx"
OUTPUTS = {"original.xlsx": "Physical_Inventory", "incoming.xlsx": "SAP_Export"}


def main(src: Path = PRACTICE, out_dir: Path = FIXTURES) -> None:
    for name, keep in OUTPUTS.items():
        wb = load_workbook(src)
        for ws in list(wb.worksheets):
            if ws.title != keep:
                wb.remove(ws)
        wb.active = 0
        wb[keep].sheet_state = "visible"
        wb.save(out_dir / name)
        print(f"{out_dir / name}: sheet {keep}")


if __name__ == "__main__":
    main(*(Path(a) for a in sys.argv[1:3]))
