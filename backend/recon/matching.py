"""Score-based matching of the incoming list against the original inventory (v2).

1. Every (existing unit, incoming row) pair gets a 0-100 score: the share of the criteria
   (type, colour, size, location, material; all equally important) that could be compared
   and agree.
2. Automatic pairs need a full match (the threshold in ``config/scoring.yaml``, 100 %);
   anything less is left for manual review.
   They are chosen by one global one-to-one assignment: first as many pairs as possible, then
   the highest total score.
3. Among the assignments that are optimal by (2), ties are broken lexicographically (rule 3.2):
   incoming rows in file order, each taking its best-scoring unit and, among equal scores, the
   one with the newest activation date. The tie-break is applied only between solutions that
   are already optimal, so it can never outweigh a real score difference.
4. The user's decisions (manual pairs, "no pair", swaps) are laid over the automatic result.

The original inventory is only read. Nothing here writes files.
"""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment

from .config import AppConfig, default_config
from .engine import classify
from .errors import ReconError
from .intake import SourceUpload, find_duplicate_rows
from .loader import EXCEL_ROW
from .match_models import (
    RESOLVED_STATUSES,
    Candidate,
    Criterion,
    CriterionCheck,
    ExistingItem,
    IncomingItem,
    IncomingResult,
    LogAction,
    LogEntry,
    MatchResult,
    MatchSummary,
    NoMatchReason,
    RowStatus,
)
from .messages import Note, note

SCORE_UNITS = 10_000  # scores are compared as integers: 100.00 % = 10 000 units
QR_DIGITS_RE = re.compile(r"(\d+)")


class AssignmentError(ReconError):
    code = "invalid_assignment"


class SwapRequiredError(ReconError):
    """The chosen unit belongs to another row; the user must confirm the swap."""

    code = "swap_required"


class UnknownRowError(ReconError):
    code = "row_not_found"


def _norm(text: object) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip().casefold()


def _date(v) -> dt.date | None:
    return None if v is None or pd.isna(v) else pd.Timestamp(v).date()


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


# --- inputs ----------------------------------------------------------------------------------


def existing_units(original: SourceUpload, cfg: AppConfig) -> list[ExistingItem]:
    """One unit per Asset ID: exact double entries and later repeats of an ID are skipped."""
    dups = find_duplicate_rows(original.sheet)
    excluded = {_norm(s) for s in cfg.matching.excluded_statuses}
    keywords = [_norm(k) for k in cfg.scoring.material_keywords]
    seen: set[str] = set()
    units = []
    for r in original.frame.to_dict("records"):
        row, aid = int(r[EXCEL_ROW]), r["asset_id"]
        if row in dups or not aid or aid in seen:
            continue
        seen.add(aid)
        desc = _norm(r["description"])
        units.append(
            ExistingItem(
                excel_row=row,
                asset_id=aid,
                item_name=r["item_name"],
                description=r["description"],
                sap_type=classify(r["item_name"], r["description"], cfg.type_rules.rules),
                color=r["color"],
                width_cm=r["width_cm"],
                size_word=r["size_word"],
                materials=[k for k in keywords if re.search(rf"\b{re.escape(k)}\b", desc)],
                city=r["city"],
                building=r["building"],
                custodian=r["custodian"],
                activation_date=_date(r["activation_date"]),
                deactivation_date=_date(r["deactivation_date"]),
                status=r["status"],
                defective=bool(r["status"]) and _norm(r["status"]) in excluded,
            )
        )
    return units


def incoming_items(incoming: SourceUpload) -> list[IncomingItem]:
    dups = find_duplicate_rows(incoming.sheet)
    return [
        IncomingItem(
            excel_row=int(r[EXCEL_ROW]),
            duplicate_of=dups.get(int(r[EXCEL_ROW])),
            **{
                k: r[k] for k in IncomingItem.model_fields if k not in {"excel_row", "duplicate_of"}
            },
        )
        for r in incoming.frame.to_dict("records")
    ]


# --- scoring ---------------------------------------------------------------------------------


class Scorer:
    def __init__(self, items: list[IncomingItem], cfg: AppConfig):
        self.cfg = cfg
        self.synonyms = {
            _norm(k): {_norm(k), *(_norm(v) for v in vs)}
            for k, vs in cfg.scoring.material_synonyms.items()
        }
        # Widths per (type, building) and per type, for "small"/"large" (rule 1b).
        self._widths: dict[tuple[str, str | None], set[int]] = {}
        for s in items:
            if s.duplicate_of is None and s.width_cm is not None:
                for key in ((_norm(s.item_name), s.building), (_norm(s.item_name), None)):
                    self._widths.setdefault(key, set()).add(s.width_cm)

    def size_target(self, p: ExistingItem) -> int | None:
        """The width ``small``/``large`` stands for, or None if it does not restrict."""
        if not p.size_word:
            return None
        t = _norm(p.sap_type)
        widths = self._widths.get((t, p.building)) or self._widths.get((t, None)) or set()
        if len(widths) < 2:
            return None
        return min(widths) if p.size_word == "small" else max(widths)

    def _material_match(self, p: ExistingItem, material: str) -> bool:
        words = set(re.findall(r"[a-z]+", _norm(material)))
        return any(words & self.synonyms.get(k, {k}) for k in p.materials)

    def checks(self, p: ExistingItem, s: IncomingItem) -> list[CriterionCheck]:
        def check(c, evaluable, match, existing, incoming):
            return CriterionCheck(
                criterion=c,
                evaluable=evaluable,
                match=match if evaluable else None,
                existing=existing,
                incoming=incoming,
            )

        out = [
            check(
                Criterion.TYPE,
                True,
                p.sap_type is not None and _norm(p.sap_type) == _norm(s.item_name),
                p.sap_type or p.item_name,
                s.item_name,
            ),
            check(
                Criterion.COLOR,
                bool(p.color and s.color),
                _norm(p.color) == _norm(s.color),
                p.color,
                s.color,
            ),
        ]
        incoming_width = None if s.width_cm is None else f"{s.width_cm} cm"
        if p.width_cm is not None:
            out.append(
                check(
                    Criterion.SIZE,
                    s.width_cm is not None,
                    p.width_cm == s.width_cm,
                    f"{p.width_cm} cm",
                    incoming_width,
                )
            )
        else:
            target = self.size_target(p)
            out.append(
                check(
                    Criterion.SIZE,
                    target is not None and s.width_cm is not None,
                    s.width_cm == target,
                    f"{p.size_word} ({target} cm)" if target else p.size_word,
                    incoming_width,
                )
            )
        out.append(
            check(
                Criterion.LOCATION,
                bool(p.building and s.building),
                p.building == s.building,
                p.city,
                s.building,
            )
        )
        out.append(
            check(
                Criterion.MATERIAL,
                bool(p.materials and s.material),
                bool(s.material) and self._material_match(p, s.material or ""),
                ", ".join(p.materials) or None,
                s.material,
            )
        )
        return out

    @staticmethod
    def units(checks: list[CriterionCheck]) -> int:
        judged = sum(c.evaluable for c in checks)
        agreed = sum(bool(c.evaluable and c.match) for c in checks)
        return round(SCORE_UNITS * agreed / judged) if judged else 0

    @staticmethod
    def hard_ok(checks: list[CriterionCheck]) -> bool:
        hard = {Criterion.TYPE, Criterion.COLOR, Criterion.SIZE}
        return all(c.match for c in checks if c.criterion in hard and c.evaluable)


# --- automatic assignment ------------------------------------------------------------------


@dataclass
class AutoPair:
    asset_id: str
    tie_resolved: bool


def _date_key(p: ExistingItem) -> int:
    return p.activation_date.toordinal() if p.activation_date else 0


class _Component:
    """Incoming rows and units linked by automatic-match edges; solved independently."""

    def __init__(self, srows: list[int], pids: list[str], edges: dict[tuple[int, str], int]):
        self.srows, self.pids, self.edges = srows, pids, edges
        # value of a pair: one "count" unit worth more than any total score, plus the score
        self.big = SCORE_UNITS * (len(srows) + 1)

    def value(self, s: int, p: str) -> int:
        u = self.edges.get((s, p))
        return 0 if u is None else self.big + u

    def best(self, fixed: dict[int, str | None]) -> int:
        """Best total value with the ``fixed`` rows set (None = left unmatched)."""
        total = sum(self.value(s, p) for s, p in fixed.items() if p is not None)
        if any(p is not None and (s, p) not in self.edges for s, p in fixed.items()):
            return -1
        taken = {p for p in fixed.values() if p is not None}
        rs = [s for s in self.srows if s not in fixed]
        ps = [p for p in self.pids if p not in taken]
        if rs and ps:
            m = np.array([[self.value(s, p) for p in ps] for s in rs], dtype=float)
            i, j = linear_sum_assignment(m, maximize=True)
            total += int(m[i, j].sum())
        return total


def auto_match(
    units: list[ExistingItem], items: list[IncomingItem], scorer: Scorer, cfg: AppConfig
) -> dict[int, AutoPair]:
    """incoming row -> automatic pair."""
    threshold = round(cfg.scoring.auto_match_threshold * SCORE_UNITS / 100)
    unit_by_id = {u.asset_id: u for u in units}
    edges: dict[tuple[int, str], int] = {}
    for s in items:
        if s.duplicate_of is not None:
            continue
        for p in units:
            if p.defective:
                continue
            checks = scorer.checks(p, s)
            u = scorer.units(checks)
            if scorer.hard_ok(checks) and u >= threshold:
                edges[(s.excel_row, p.asset_id)] = u

    # connected components of the edge graph
    parent: dict[object, object] = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for s, p in edges:
        parent[find(("s", s))] = find(("p", p))
    groups: dict[object, tuple[list[int], list[str]]] = {}
    for node in list(parent):
        srows, pids = groups.setdefault(find(node), ([], []))
        (srows if node[0] == "s" else pids).append(node[1])

    out: dict[int, AutoPair] = {}
    for srows, pids in groups.values():
        out.update(_solve(_Component(sorted(srows), pids, edges), unit_by_id))
    return out


def _solve(comp: _Component, unit_by_id: dict[str, ExistingItem]) -> dict[int, AutoPair]:
    edges = comp.edges
    opt = comp.best({})

    def order(s: int) -> list[str]:
        """Units for row ``s``: best score first, then newest activation date."""
        cands = [p for p in comp.pids if (s, p) in edges]
        return sorted(
            cands,
            key=lambda p: (-edges[(s, p)], -_date_key(unit_by_id[p]), unit_by_id[p].excel_row),
        )

    # Lexicographic tie-break among optimal solutions (rule 3.2): rows in file order, each
    # taking the first unit in its order that still allows an optimal solution.
    fixed: dict[int, str | None] = {}
    for s in comp.srows:
        taken = set(fixed.values())
        fixed[s] = next(
            (p for p in order(s) if p not in taken and comp.best({**fixed, s: p}) == opt),
            None,
        )
    out: dict[int, AutoPair] = {}
    for s, p in fixed.items():
        if p is None:
            continue
        # Rule 3.2 decided this pair if another optimum gives this row an equally scored unit,
        # or gives this unit to another row at the same score.
        u = edges[(s, p)]
        tie = any(
            q != p and edges[(s, q)] == u and comp.best({s: q}) == opt for q in order(s)
        ) or any(r != s and edges.get((r, p)) == u and comp.best({r: p}) == opt for r in comp.srows)
        out[s] = AutoPair(asset_id=p, tie_resolved=tie)
    return out


# --- a session's matching state ----------------------------------------------------------------


@dataclass
class Decision:
    asset_id: str | None  # None = "no pair"
    reason: NoMatchReason | None
    note: str | None
    at: dt.datetime


@dataclass
class Matching:
    """The automatic result for one original + incoming upload, plus the user's decisions."""

    original: SourceUpload
    incoming: SourceUpload
    cfg: AppConfig = field(default_factory=default_config)
    decisions: dict[int, Decision] = field(default_factory=dict)
    released: set[int] = field(default_factory=set)  # rows whose unit went to another row
    log: list[LogEntry] = field(default_factory=list)

    def __post_init__(self):
        self.units = existing_units(self.original, self.cfg)
        self.unit_by_id = {u.asset_id: u for u in self.units}
        self.items = incoming_items(self.incoming)
        self.item_by_row = {s.excel_row: s for s in self.items}
        self.scorer = Scorer(self.items, self.cfg)
        self.auto = auto_match(self.units, self.items, self.scorer, self.cfg)

    # -- current state --

    def current(self) -> dict[int, str | None]:
        """incoming row -> Asset ID it holds now (None = nothing)."""
        out: dict[int, str | None] = {}
        for s in self.items:
            r = s.excel_row
            if r in self.decisions:
                out[r] = self.decisions[r].asset_id
            elif r in self.released or r not in self.auto:
                out[r] = None
            else:
                out[r] = self.auto[r].asset_id
        return out

    def holder_of(self, asset_id: str, current: dict[int, str | None] | None = None) -> int | None:
        current = self.current() if current is None else current
        return next((r for r, a in current.items() if a == asset_id), None)

    def _item(self, row: int) -> IncomingItem:
        item = self.item_by_row.get(row)
        if item is None:
            raise UnknownRowError(f"Row {row} is not a data row of the incoming list.")
        return item

    # -- decisions --

    def assign(
        self,
        row: int,
        asset_id: str | None,
        reason: NoMatchReason | None = None,
        note_text: str | None = None,
        confirm_swap: bool = False,
        now: dt.datetime | None = None,
    ) -> int | None:
        """Pair ``row`` with ``asset_id``, or record "no pair" (``asset_id`` None, reason
        required). Returns the row that lost its unit in a swap, if any."""
        self._item(row)
        now = now or _now()
        current = self.current()
        old = current[row]
        note_text = (note_text or "").strip() or None
        if asset_id is None:
            if reason is None:
                raise AssignmentError(
                    "Choose a reason when an item has no existing pair.",
                    [{"field": "reason", "problem": "required when asset_id is null"}],
                )
            if reason is NoMatchReason.OTHER and not note_text:
                raise AssignmentError(
                    "Add a note when the reason is 'Other'.",
                    [{"field": "note", "problem": "required when reason is 'other'"}],
                )
            self.decisions[row] = Decision(None, reason, note_text, now)
            self.released.discard(row)
            self.log.append(
                LogEntry(
                    at=now,
                    row=row,
                    action=LogAction.NO_MATCH,
                    old_asset_id=old,
                    new_asset_id=None,
                    reason=reason,
                    note=note_text,
                )
            )
            return None

        if asset_id not in self.unit_by_id:
            raise AssignmentError(
                f"Asset ID {asset_id} is not in the original inventory.",
                [{"field": "asset_id", "problem": "unknown Asset ID"}],
            )
        released = self._take(asset_id, row, current, confirm_swap, now)
        self.decisions[row] = Decision(asset_id, reason, note_text, now)
        self.released.discard(row)
        self.log.append(
            LogEntry(
                at=now,
                row=row,
                action=LogAction.ASSIGN,
                old_asset_id=old,
                new_asset_id=asset_id,
                reason=reason,
                note=note_text,
            )
        )
        return released

    def reset(self, row: int, confirm_swap: bool = False, now: dt.datetime | None = None):
        """Back to the automatic suggestion. Returns the row that lost its unit, if any."""
        self._item(row)
        now = now or _now()
        current = self.current()
        old = current[row]
        auto = self.auto.get(row)
        released = None
        if auto is not None:
            released = self._take(auto.asset_id, row, current, confirm_swap, now)
        self.decisions.pop(row, None)
        self.released.discard(row)
        self.log.append(
            LogEntry(
                at=now,
                row=row,
                action=LogAction.RESET,
                old_asset_id=old,
                new_asset_id=auto.asset_id if auto else None,
            )
        )
        return released

    def _take(self, asset_id, row, current, confirm_swap, now) -> int | None:
        holder = self.holder_of(asset_id, current)
        if holder is None or holder == row:
            return None
        if not confirm_swap:
            raise SwapRequiredError(
                f"Asset ID {asset_id} is assigned to row {holder}. Confirm the swap: "
                f"row {holder} goes back to the items to resolve.",
                [{"asset_id": asset_id, "row": holder, "problem": "assigned to another row"}],
            )
        self.decisions.pop(holder, None)
        self.released.add(holder)
        self.log.append(
            LogEntry(
                at=now,
                row=holder,
                action=LogAction.RELEASED,
                old_asset_id=asset_id,
                new_asset_id=None,
                note=f"Unit given to row {row}.",
            )
        )
        return holder

    # -- candidates --

    def candidates(
        self,
        row: int,
        include_paired: bool = False,
        include_other_types: bool = False,
        include_defective: bool = False,
        q: str | None = None,
    ) -> list[Candidate]:
        s = self._item(row)
        current = self.current()
        holder = {a: r for r, a in current.items() if a is not None}
        qr = _qr_asset_id(s.qr_code)
        needle = _norm(q)
        out = []
        for p in self.units:
            held_by = holder.get(p.asset_id)
            is_qr = qr is not None and qr == p.asset_id
            if not is_qr:  # a QR match is always shown
                if p.defective and not include_defective:
                    continue
                if held_by not in (None, row) and not include_paired:
                    continue
                if not include_other_types and _norm(p.sap_type) != _norm(s.item_name):
                    continue
            if needle and not any(
                needle in _norm(v) for v in (p.asset_id, p.description, p.custodian)
            ):
                continue
            checks = self.scorer.checks(p, s)
            out.append(
                Candidate(
                    existing=p,
                    score=self.scorer.units(checks) / 100,
                    checks=checks,
                    hard_ok=self.scorer.hard_ok(checks),
                    qr_match=is_qr,
                    paired_row=held_by,
                )
            )
        out.sort(key=lambda c: (not c.qr_match, -c.score, -_date_key(c.existing)))
        return out

    # -- result --

    def row_result(self, s: IncomingItem, current: dict[int, str | None]) -> IncomingResult:
        r = s.excel_row
        aid = current[r]
        auto = self.auto.get(r)
        decision = self.decisions.get(r)
        notes: list[Note] = []
        p = self.unit_by_id.get(aid) if aid else None
        checks = self.scorer.checks(p, s) if p else []
        mismatch = bool(p and p.building and s.building and p.building != s.building)
        tie = False
        if decision is not None:
            status = RowStatus.MANUAL if aid else RowStatus.NO_MATCH
        elif r in self.released:
            status = RowStatus.DUPLICATE if s.duplicate_of else RowStatus.NO_CANDIDATE
            if auto:
                notes.append(note("released_by_swap", asset_id=auto.asset_id))
        elif s.duplicate_of is not None:
            status = RowStatus.DUPLICATE
        elif auto is None:
            status = RowStatus.NO_CANDIDATE
            notes.append(note("no_candidate", threshold=self.cfg.scoring.auto_match_threshold))
        else:
            tie = auto.tie_resolved
            if mismatch:
                status = RowStatus.LOCATION_MISMATCH
            elif tie:
                status = RowStatus.AUTO_NEWEST
            else:
                status = RowStatus.AUTO
            if tie:
                notes.append(note("tie_newest"))
        if s.duplicate_of is not None:
            notes.insert(0, note("incoming_duplicate", first=s.duplicate_of))
        if p is not None:
            if mismatch:
                notes.append(note("location_mismatch", city=p.city, building=s.building))
            if p.deactivation_date is not None:
                notes.append(note("deactivated"))
            if p.defective:
                notes.append(note("defective_chosen"))
        return IncomingResult(
            item=s,
            status=status,
            resolved=status in RESOLVED_STATUSES,
            asset_id=aid,
            existing_row=p.excel_row if p else None,
            score=self.scorer.units(checks) / 100 if p else None,
            checks=checks,
            location_mismatch=mismatch,
            tie_resolved=tie,
            auto_asset_id=auto.asset_id if auto else None,
            reason=decision.reason if decision else None,
            note=decision.note if decision else None,
            notes=notes,
        )

    def result(self) -> MatchResult:
        current = self.current()
        rows = [self.row_result(s, current) for s in self.items]
        held = {a for a in current.values() if a}
        unpaired = [u for u in self.units if u.asset_id not in held]
        counts = {st.value: 0 for st in RowStatus}
        for x in rows:
            counts[x.status.value] += 1
        resolved = sum(x.resolved for x in rows)
        warnings = [i.note for i in self.original.issues + self.incoming.issues]
        return MatchResult(
            summary=MatchSummary(
                incoming_rows=len(rows),
                existing_units=len(self.units),
                resolved=resolved,
                unresolved=len(rows) - resolved,
                status_counts=counts,
                location_mismatches=sum(x.location_mismatch for x in rows),
                tie_resolved=sum(x.tie_resolved for x in rows),
                unpaired_existing=sum(not u.defective for u in unpaired),
                auto_match_threshold=self.cfg.scoring.auto_match_threshold,
                export_ready=resolved == len(rows),
            ),
            rows=rows,
            unpaired_existing=unpaired,
            log=list(self.log),
            warnings=warnings,
        )


def _qr_asset_id(qr: str | None) -> str | None:
    """The Asset ID a QR code names, if its digits form one (INV0084219511 -> 84219511)."""
    m = QR_DIGITS_RE.search(qr or "")
    return str(int(m.group(1))) if m else None
