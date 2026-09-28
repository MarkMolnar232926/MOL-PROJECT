"""Console summary of a matching run.

python -m recon.report ORIGINAL.xlsx INCOMING.xlsx

Prints the status counts, every incoming row, and the groups whose pairs were decided by the
newest-activation-date rule (3.2).
"""

from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

from .errors import ReconError
from .intake import read_upload
from .loader import InputFile
from .matching import Matching


def format_report(m: Matching) -> str:
    res = m.result()
    s = res.summary
    out = [
        f"Incoming rows {s.incoming_rows}: resolved {s.resolved}, unresolved {s.unresolved}   "
        f"(existing units {s.existing_units}, unpaired {s.unpaired_existing})",
        "Status: " + ", ".join(f"{k} {v}" for k, v in s.status_counts.items() if v),
        "",
        f"{'row':>4}  {'item':<18}{'width':>6} {'bldg':<5}{'status':<19}{'asset id':<10}"
        f"{'score':>7}  {'city':<10}{'activated':<11}",
    ]
    for r in res.rows:
        u = m.unit_by_id.get(r.asset_id) if r.asset_id else None
        out.append(
            f"{r.item.excel_row:>4}  {r.item.item_name or '':<18}{r.item.width_cm or '':>6} "
            f"{r.item.building or '':<5}{r.status.value:<19}{r.asset_id or '-':<10}"
            f"{r.score if r.score is not None else '':>7}  {(u.city if u else '') or '':<10}"
            f"{str(u.activation_date) if u else '':<11}"
        )

    groups: dict[tuple, list] = defaultdict(list)
    for r in res.rows:
        if r.tie_resolved:
            groups[(r.item.item_name, r.item.color, r.item.width_cm)].append(r)
    out += ["", "Decided by the newest-date rule (3.2): rows in file order, newest unit first"]
    for (item, color, width), members in sorted(
        groups.items(), key=lambda kv: kv[1][0].item.excel_row
    ):
        out.append(f"  {item}, {color}, {width} cm")
        for r in members:
            u = m.unit_by_id[r.asset_id]
            out.append(
                f"    row {r.item.excel_row:>3} ({r.item.building}) -> {u.asset_id}  "
                f"activated {u.activation_date}  {u.city}"
                + ("  [location differs]" if r.location_mismatch else "")
            )
    for w in res.warnings:
        out.append(f"warning: {w.text}")
    return "\n".join(out)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__.strip())
        return 2
    try:
        original, incoming = (
            read_upload(InputFile(Path(p).name, Path(p).read_bytes()), source)
            for p, source in zip(argv, ("physical", "sap"), strict=True)
        )
        print(format_report(Matching(original, incoming)))
    except ReconError as exc:
        print(f"error: {exc.message}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
