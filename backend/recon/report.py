"""Console summary of a reconciliation run.

python -m recon.report WORKBOOK.xlsx
python -m recon.report PHYSICAL.xlsx SAP.xlsx
"""

from __future__ import annotations

import sys
from pathlib import Path

from .engine import reconcile
from .errors import ReconError
from .loader import InputFile, load_inputs
from .models import ReconResult
from .normalize import normalize


def format_report(res: ReconResult) -> str:
    s = res.summary
    out = [
        f"Rules v{s.rules_version}",
        f"Rows: physical {s.physical_total}, SAP {s.sap_total}   pairs {s.pairs}   "
        f"location mismatches {s.location_mismatches}",
        "Physical status: " + ", ".join(f"{k} {v}" for k, v in s.physical_status_counts.items()),
        "SAP status:      " + ", ".join(f"{k} {v}" for k, v in s.sap_status_counts.items()),
        "Confidence:      " + ", ".join(f"{k} {v}" for k, v in s.confidence_counts.items()),
        f"Tie groups: {s.tie_groups}, slots {s.tie_slots}, pending {s.tie_slots_pending}; "
        f"manual decisions {s.manual_decisions}",
    ]
    if res.tie_groups:
        out += ["", "Tie groups:"]
    for g in res.tie_groups:
        out.append(
            f"  {g.group_id}: {g.sap_type}, {g.color}, width {g.width_cm}, year {g.year}, "
            f"{'/'.join(g.locations)}"
        )
        cands = {c.asset_id: c for c in g.candidates}
        for sl in g.slots:
            sug = cands.get(sl.suggested_asset_id)
            detail = f"{sug.asset_id} ({sug.activation_date}, {sug.building})" if sug else "none"
            state = f"chosen {sl.chosen_asset_id}" if sl.decided else f"suggested {detail}"
            out.append(f"     SAP row {sl.sap_row:>3} {sl.serial_no} {sl.building}: {state}")
    counts: dict[str, int] = {}
    for d in res.discrepancies:
        counts[d.kind.value] = counts.get(d.kind.value, 0) + 1
    out += ["", "Discrepancies: " + (", ".join(f"{k} {v}" for k, v in counts.items()) or "none")]
    out += [f"WARNING: {w}" for w in res.warnings]
    return "\n".join(out)


def main(argv: list[str]) -> int:
    paths = list(argv)
    if len(paths) not in (1, 2):
        print(__doc__)
        return 2
    roles = [None] if len(paths) == 1 else ["physical", "sap"]
    files = [
        InputFile(Path(p).name, Path(p).read_bytes(), r) for p, r in zip(paths, roles, strict=True)
    ]
    try:
        res = reconcile(normalize(load_inputs(files)))
    except ReconError as exc:
        print(f"ERROR [{exc.code}]: {exc.message}")
        return 1
    print(format_report(res))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
