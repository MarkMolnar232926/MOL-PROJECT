"""The matching engine (PLAN.md section 6).

``reconcile()`` is a pure function of the normalised input, the config and the list of manual
tie decisions, so a session can simply re-run it after every change.
"""

from __future__ import annotations

import datetime as dt
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment

from .config import AppConfig, TypeRule, default_config
from .errors import ReconError
from .loader import EXCEL_ROW, SheetData
from .messages import Note, note
from .models import (
    Confidence,
    Discrepancy,
    DiscrepancyKind,
    ManualDecision,
    MatchStatus,
    Pair,
    PhysicalRow,
    ReconResult,
    SapRow,
    Summary,
    TieAssignment,
    TieCandidate,
    TieGroup,
    TieSlot,
)
from .normalize import NormalizedInput

INF = 1e9
UNKNOWN_YEAR_GAP = 10  # cost used when a year cannot be read (treated as a 10-year gap)


class TieDecisionError(ReconError):
    code = "invalid_tie_decision"


# --- classification & duplicates ----------------------------------------------------------


def _norm(text: object) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip().casefold()


def classify(item_name: str | None, description: str | None, rules: list[TypeRule]) -> str | None:
    """First rule whose item equals the item name and whose keyword occurs in the description."""
    item, desc = _norm(item_name), _norm(description)
    for rule in rules:
        if _norm(rule.item) == item and _norm(rule.keyword) in desc:
            return rule.sap_type
    return None


def find_duplicates(sheet: SheetData) -> dict[int, int]:
    """Map excel_row -> excel_row of the first identical row (all original columns equal)."""
    first_seen: dict[tuple, int] = {}
    dup_of: dict[int, int] = {}
    cols = [c for c in sheet.frame.columns if c != EXCEL_ROW]
    for values, excel_row in zip(
        sheet.frame[cols].itertuples(index=False, name=None), sheet.frame[EXCEL_ROW], strict=True
    ):
        key = tuple(None if pd.isna(v) else v for v in values)
        if key in first_seen:
            dup_of[int(excel_row)] = first_seen[key]
        else:
            first_seen[key] = int(excel_row)
    return dup_of


# --- matching core ----------------------------------------------------------------------------


@dataclass
class _Tie:
    sap_type: str
    sap_rows: list[int]
    phys_rows: list[int]


@dataclass
class _Core:
    """The raw outcome of one matching pass."""

    pairs: dict[int, int] = field(default_factory=dict)  # sap_row -> phys_row
    ties: list[_Tie] = field(default_factory=list)
    pool_s: dict[str, list[int]] = field(default_factory=dict)  # type -> sap rows in fuzzy pool
    pool_p: dict[str, list[int]] = field(default_factory=dict)


class _Matcher:
    def __init__(self, phys: dict[int, dict], sap: dict[int, dict], cfg: AppConfig):
        self.phys, self.sap, self.cfg = phys, sap, cfg
        self.w = cfg.matching.cost_weights
        self.sap_by_type: dict[str, list[int]] = defaultdict(list)
        for r, s in sap.items():
            if s["_eligible"]:
                self.sap_by_type[_norm(s["item_name"])].append(r)
        self.size_target = {r: self._size_target(p) for r, p in phys.items() if p["_eligible"]}

    def _size_target(self, p: dict) -> int | None:
        if not p["size_word"]:
            return None
        rows = self.sap_by_type.get(_norm(p["sap_type"]), [])
        same_loc = [r for r in rows if self.sap[r]["building"] == p["building"]]
        widths = {self.sap[r]["width_cm"] for r in (same_loc or rows)} - {None}
        if len(widths) < 2:
            return None  # only one size exists: the size word is not restrictive
        return min(widths) if p["size_word"] == "small" else max(widths)

    def feasible(self, pr: int, sr: int) -> bool:
        p, s = self.phys[pr], self.sap[sr]
        if _norm(p["sap_type"]) != _norm(s["item_name"]) or p["color"] != s["color"]:
            return False
        if p["width_cm"] is not None and p["width_cm"] != s["width_cm"]:
            return False
        target = self.size_target.get(pr)
        return target is None or s["width_cm"] == target

    def year_gap(self, pr: int, sr: int) -> int | None:
        a, b = self.phys[pr]["activation_year"], self.sap[sr]["serial_year"]
        return None if a is None or b is None else abs(a - b)

    def loc_mismatch(self, pr: int, sr: int) -> bool:
        return self.phys[pr]["building"] != self.sap[sr]["building"]

    def primary_cost(self, pr: int, sr: int) -> float:
        gap = self.year_gap(pr, sr)
        return self.w.year_gap * (UNKNOWN_YEAR_GAP if gap is None else gap) + (
            self.w.location_mismatch * self.loc_mismatch(pr, sr)
        )

    def assign(self, prows: list[int], srows: list[int]) -> dict[int, int]:
        """Min-cost assignment; returns sap_row -> phys_row for feasible pairs only."""
        if not prows or not srows:
            return {}
        p_sorted = sorted(prows, key=lambda r: (self._date_key(r), r))
        s_sorted = sorted(srows, key=lambda r: self._serial_key(r))
        rank_p = {r: i for i, r in enumerate(p_sorted)}
        rank_s = {r: i for i, r in enumerate(s_sorted)}
        cost = np.full((len(p_sorted), len(s_sorted)), INF)
        for i, pr in enumerate(p_sorted):
            for j, sr in enumerate(s_sorted):
                if self.feasible(pr, sr):
                    cost[i, j] = self.primary_cost(pr, sr) + self.w.fifo_rank * (
                        (rank_p[pr] - rank_s[sr]) ** 2
                    )
        rows, cols = linear_sum_assignment(cost)
        return {
            s_sorted[j]: p_sorted[i] for i, j in zip(rows, cols, strict=True) if cost[i, j] < INF
        }

    def _date_key(self, r: int):
        d = self.phys[r]["activation_date"]
        return d if d is not None else pd.Timestamp.max

    def _serial_key(self, r: int):
        s = self.sap[r]
        return (s["serial_year"] or 9999, s["serial_no"] or "", r)

    # -- passes --

    def run(self) -> _Core:
        core = _Core()
        types = sorted(
            {_norm(p["sap_type"]) for p in self.phys.values() if p["_eligible"]}
            | set(self.sap_by_type)
        )
        for t in types:
            prows = [
                r for r, p in self.phys.items() if p["_eligible"] and _norm(p["sap_type"]) == t
            ]
            srows = list(self.sap_by_type.get(t, []))
            core.pool_p[t], core.pool_s[t] = prows, srows
            assigned = self.assign(prows, srows)
            core.pairs.update(assigned)
            core.ties.extend(self._find_ties(t, prows, srows, assigned))
        return core

    def _find_ties(
        self, sap_type: str, prows: list[int], srows: list[int], assigned: dict[int, int]
    ) -> list[_Tie]:
        """Group pairs whose units are interchangeable: same years, equally good when swapped."""
        parent: dict[tuple[str, int], tuple[str, int]] = {}

        def find(x):
            parent.setdefault(x, x)
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        def union(a, b):
            parent[find(a)] = find(b)

        pairs = sorted(assigned.items())
        linked: set[tuple[str, int]] = set()
        for i, (s1, p1) in enumerate(pairs):
            for s2, p2 in pairs[i + 1 :]:
                if (
                    self.sap[s1]["serial_year"] == self.sap[s2]["serial_year"]
                    and self.phys[p1]["activation_year"] == self.phys[p2]["activation_year"]
                    and self.feasible(p1, s2)
                    and self.feasible(p2, s1)
                    and self.primary_cost(p1, s2) + self.primary_cost(p2, s1)
                    == self.primary_cost(p1, s1) + self.primary_cost(p2, s2)
                ):
                    union(("s", s1), ("s", s2))
                    linked |= {("s", s1), ("s", s2)}
        # An unmatched row that could replace a matched one at equal cost is part of the tie too.
        free_s = [r for r in srows if r not in assigned]
        free_p = [r for r in prows if r not in assigned.values()]
        for s1, p1 in pairs:
            for s2 in free_s:
                if (
                    self.sap[s2]["serial_year"] == self.sap[s1]["serial_year"]
                    and self.feasible(p1, s2)
                    and self.primary_cost(p1, s2) == self.primary_cost(p1, s1)
                ):
                    union(("s", s1), ("s", s2))
                    linked |= {("s", s1), ("s", s2)}
            for p2 in free_p:
                if (
                    self.phys[p2]["activation_year"] == self.phys[p1]["activation_year"]
                    and self.feasible(p2, s1)
                    and self.primary_cost(p2, s1) == self.primary_cost(p1, s1)
                ):
                    union(("s", s1), ("p", p2))
                    linked |= {("s", s1), ("p", p2)}

        groups: dict[tuple[str, int], set[tuple[str, int]]] = defaultdict(set)
        for node in linked:
            groups[find(node)].add(node)
        ties = []
        for members in groups.values():
            s_rows = sorted(r for k, r in members if k == "s")
            p_rows = {r for k, r in members if k == "p"} | {
                assigned[r] for r in s_rows if r in assigned
            }
            ties.append(_Tie(sap_type, s_rows, sorted(p_rows)))
        return ties


# --- public API ---------------------------------------------------------------------------------


def _records(frame: pd.DataFrame) -> dict[int, dict]:
    return {int(r[EXCEL_ROW]): dict(r) for r in frame.to_dict("records")}


def _date(v) -> object:
    return None if v is None or pd.isna(v) else pd.Timestamp(v).date()


def _float(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if np.isnan(f) else f


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.casefold()).strip("-")


def reconcile(
    data: NormalizedInput,
    cfg: AppConfig | None = None,
    *,
    decisions: list[ManualDecision] | None = None,
) -> ReconResult:
    cfg = cfg or default_config()
    loaded = data.loaded
    phys = _records(data.physical)
    sap = _records(data.sap)
    excluded = {_norm(s) for s in cfg.matching.excluded_statuses}
    discrepancies: list[Discrepancy] = []
    warnings: list[Note] = list(loaded.warnings)

    phys_dup = find_duplicates(loaded.physical)
    sap_dup = find_duplicates(loaded.sap)
    for r, p in phys.items():
        p["sap_type"] = classify(p["item_name"], p["description"], cfg.type_rules.rules)
        p["_defective"] = _norm(p["status"]) in excluded if p["status"] else False
        p["_eligible"] = r not in phys_dup and not p["_defective"] and p["sap_type"] is not None
    for r, s in sap.items():
        s["_eligible"] = r not in sap_dup

    _data_quality(phys, sap, phys_dup, sap_dup, data, discrepancies)

    matcher = _Matcher(phys, sap, cfg)
    core = matcher.run()

    groups, kept_decisions = _build_ties(matcher, core, decisions or [], warnings)
    tie_of_sap = {r: g for g in groups for r in g.sap_rows}
    tie_of_phys = {r: g for g in groups for r in g.physical_rows}

    # Final (sap_row -> phys_row) incl. tie state: decided slots use the choice, others the
    # suggestion (marked provisional).
    asset_row = {g.group_id: {c.asset_id: c.physical_row for c in g.candidates} for g in groups}
    final: dict[int, tuple[int, bool]] = {}  # sap_row -> (phys_row, provisional)
    for sr, pr in core.pairs.items():
        if sr not in tie_of_sap:
            final[sr] = (pr, False)
    for g in groups:
        for slot in g.slots:
            aid = slot.chosen_asset_id if slot.decided else slot.suggested_asset_id
            if aid is not None:
                final[slot.sap_row] = (asset_row[g.group_id][aid], not slot.decided)
    phys_match = {pr: (sr, prov) for sr, (pr, prov) in final.items()}

    pairs: list[Pair] = []
    for sr, (pr, prov) in sorted(final.items()):
        g = tie_of_sap.get(sr)
        pairs.append(
            Pair(
                sap_row=sr,
                physical_row=pr,
                asset_id=phys[pr]["asset_id"],
                confidence=_pair_confidence(matcher, core, sr, pr, g, prov),
                location_mismatch=matcher.loc_mismatch(pr, sr),
                year_gap=matcher.year_gap(pr, sr),
                tie_group_id=g.group_id if g else None,
                provisional=prov,
            )
        )
    pair_by_sap = {p.sap_row: p for p in pairs}

    sap_rows = [
        _sap_row(r, s, sap_dup, pair_by_sap, tie_of_sap, discrepancies)
        for r, s in sorted(sap.items())
    ]
    phys_rows = [
        _phys_row(r, p, phys_dup, phys_match, pair_by_sap, tie_of_phys, discrepancies)
        for r, p in sorted(phys.items())
    ]
    for p in pairs:
        _pair_flags(p, phys[p.physical_row], sap[p.sap_row], discrepancies)

    summary = _summary(phys_rows, sap_rows, pairs, groups, kept_decisions, cfg)
    return ReconResult(
        summary=summary,
        physical_rows=phys_rows,
        sap_rows=sap_rows,
        pairs=pairs,
        tie_groups=groups,
        discrepancies=discrepancies,
        decisions=kept_decisions,
        warnings=warnings,
    )


def _data_quality(phys, sap, phys_dup, sap_dup, data, out: list[Discrepancy]) -> None:
    for issue in data.issues:
        out.append(
            Discrepancy.of(
                DiscrepancyKind.DATA_QUALITY,
                issue.note,
                physical_row=issue.excel_row if issue.source == "physical" else None,
                sap_row=issue.excel_row if issue.source == "sap" else None,
            )
        )
    for code, rows, dups, key, col in (
        ("asset_id_conflict", phys, phys_dup, "physical_row", "asset_id"),
        ("qr_code_conflict", sap, sap_dup, "sap_row", "qr_code"),
    ):
        seen: dict[str, list[int]] = defaultdict(list)
        for r, row in rows.items():
            if r not in dups and row[col]:
                seen[row[col]].append(r)
        for value, where in seen.items():
            if len(where) > 1:
                out.append(
                    Discrepancy.of(
                        DiscrepancyKind.DATA_QUALITY,
                        note(code, value=value, rows=", ".join(map(str, where))),
                        **{key: where[0]},
                        asset_id=value if col == "asset_id" else None,
                    )
                )


def _build_ties(
    m: _Matcher, core: _Core, decisions: list[ManualDecision], warnings: list[Note]
) -> tuple[list[TieGroup], list[ManualDecision]]:
    groups: list[TieGroup] = []
    kept: list[ManualDecision] = []
    by_sap = {}
    for d in sorted(decisions, key=lambda d: d.decided_at):
        by_sap[d.sap_row] = d  # the latest decision for a slot wins
    in_any_group: set[int] = set()

    for tie in sorted(core.ties, key=lambda t: (t.sap_type, t.sap_rows)):
        s0 = m.sap[tie.sap_rows[0]]
        years = {m.sap[r]["serial_year"] for r in tie.sap_rows}
        widths = {m.sap[r]["width_cm"] for r in tie.sap_rows}
        colors = {m.sap[r]["color"] for r in tie.sap_rows}
        year = years.pop() if len(years) == 1 else None
        group_id = f"{_slug(s0['item_name'])}-{year}-r{tie.sap_rows[0]}"
        in_any_group |= set(tie.sap_rows)
        cands = [
            TieCandidate(
                physical_row=r,
                asset_id=m.phys[r]["asset_id"],
                activation_date=_date(m.phys[r]["activation_date"]),
                city=m.phys[r]["city"],
                building=m.phys[r]["building"],
                custodian=m.phys[r]["custodian"],
                gross_value=_float(m.phys[r]["gross_value"]),
            )
            for r in tie.phys_rows
        ]
        cand_ids = {c.asset_id for c in cands}
        proposed = {sr: core.pairs.get(sr) for sr in tie.sap_rows}

        # Apply still-valid decisions, one-to-one.
        chosen: dict[int, str | None] = {}
        used: set[str] = set()
        for sr in tie.sap_rows:
            d = by_sap.get(sr)
            if d is None:
                continue
            if d.asset_id is not None and (d.asset_id not in cand_ids or d.asset_id in used):
                warnings.append(note("decision_invalid", sap_row=sr, asset_id=d.asset_id))
                continue
            chosen[sr] = d.asset_id
            if d.asset_id is not None:
                used.add(d.asset_id)
            kept.append(d.model_copy(update={"group_id": group_id}))

        # Suggest the remaining slots by FIFO among the remaining candidates.
        open_s = [r for r in tie.sap_rows if r not in chosen]
        open_p = [r for r in tie.phys_rows if m.phys[r]["asset_id"] not in used]
        suggestion = m.assign(open_p, open_s)

        slots = []
        for sr in tie.sap_rows:
            s = m.sap[sr]
            decided = sr in chosen
            sug = suggestion.get(sr) if not decided else proposed.get(sr)
            slots.append(
                TieSlot(
                    sap_row=sr,
                    serial_no=s["serial_no"],
                    building=s["building"],
                    remarks=s["remarks"],
                    qr_code=s["qr_code"],
                    suggested_asset_id=m.phys[sug]["asset_id"] if sug is not None else None,
                    chosen_asset_id=chosen.get(sr),
                    decided=decided,
                    confidence=Confidence.MANUAL if decided else Confidence.NEEDS_DECISION,
                )
            )
        groups.append(
            TieGroup(
                group_id=group_id,
                sap_type=s0["item_name"],
                color=colors.pop() if len(colors) == 1 else None,
                width_cm=widths.pop() if len(widths) == 1 else None,
                year=year,
                locations=sorted(
                    {m.sap[r]["building"] for r in tie.sap_rows}
                    | {m.phys[r]["building"] for r in tie.phys_rows} - {None}
                ),
                physical_rows=tie.phys_rows,
                sap_rows=tie.sap_rows,
                candidates=cands,
                slots=slots,
                proposed_pairs=[
                    TieAssignment(
                        sap_row=sr,
                        physical_asset_id=m.phys[pr]["asset_id"] if pr is not None else None,
                    )
                    for sr, pr in proposed.items()
                ],
            )
        )

    for sr in by_sap:
        if sr not in in_any_group:
            warnings.append(note("decision_stale", sap_row=sr))
    return groups, kept


def _pair_confidence(m: _Matcher, core: _Core, sr: int, pr: int, g, provisional: bool):
    if g is not None:
        return Confidence.NEEDS_DECISION if provisional else Confidence.MANUAL
    t = _norm(m.sap[sr]["item_name"])
    alt_s = [r for r in core.pool_s.get(t, []) if r != sr and m.feasible(pr, r)]
    alt_p = [r for r in core.pool_p.get(t, []) if r != pr and m.feasible(r, sr)]
    if not alt_s and not alt_p:
        return Confidence.HIGH
    year = m.sap[sr]["serial_year"]
    if (
        m.year_gap(pr, sr) == 0
        and all(m.sap[r]["serial_year"] != year for r in alt_s)
        and all(m.phys[r]["activation_year"] != year for r in alt_p)
    ):
        return Confidence.HIGH
    return Confidence.MEDIUM


def _sap_row(r, s, sap_dup, pair_by_sap, tie_of_sap, out) -> SapRow:
    notes: list[Note] = []
    pair = pair_by_sap.get(r)
    g = tie_of_sap.get(r)
    asset_id = suggested = None
    confidence = None
    matched_row = None
    if r in sap_dup:
        status = MatchStatus.DUPLICATE
        notes.append(note("sap_duplicate", first=sap_dup[r]))
        out.append(Discrepancy.of(DiscrepancyKind.DUPLICATE, notes[-1], sap_row=r))
    elif g is not None:
        slot = next(sl for sl in g.slots if sl.sap_row == r)
        if not slot.decided:
            status, confidence = MatchStatus.NEEDS_DECISION, Confidence.NEEDS_DECISION
            suggested = slot.suggested_asset_id
            matched_row = pair.physical_row if pair else None
            notes.append(note("tie_pick", group=g.group_id, suggested=suggested))
            msg = note(
                "tie_unresolved",
                sap_type=g.sap_type,
                year=g.year,
                group=g.group_id,
                suggested=suggested,
            )
            out.append(Discrepancy.of(DiscrepancyKind.UNRESOLVED_TIE, msg, sap_row=r))
        elif slot.chosen_asset_id is None:
            status, confidence = MatchStatus.SAP_ONLY, Confidence.MANUAL
            notes.append(note("manual_unmatched"))
            out.append(Discrepancy.of(DiscrepancyKind.SAP_ONLY, notes[-1], sap_row=r))
        else:
            status, confidence = MatchStatus.MANUAL, Confidence.MANUAL
            asset_id, matched_row = pair.asset_id, pair.physical_row
    elif pair is not None:
        asset_id, matched_row, confidence = pair.asset_id, pair.physical_row, pair.confidence
        status = MatchStatus.LOCATION_MISMATCH if pair.location_mismatch else MatchStatus.MATCHED
    else:
        status = MatchStatus.SAP_ONLY
        msg = note("sap_only", item=s["item_name"])
        out.append(Discrepancy.of(DiscrepancyKind.SAP_ONLY, msg, sap_row=r))
    return SapRow(
        excel_row=r,
        item_name=s["item_name"],
        color=s["color"],
        material=s["material"],
        width_cm=s["width_cm"],
        serial_no=s["serial_no"],
        serial_year=s["serial_year"],
        building=s["building"],
        city=s["city"],
        remarks=s["remarks"],
        qr_code=s["qr_code"],
        asset_id=asset_id,
        suggested_asset_id=suggested,
        match_status=status,
        confidence=confidence,
        matched_physical_row=matched_row,
        tie_group_id=g.group_id if g else None,
        duplicate_of=sap_dup.get(r),
        notes=notes,
    )


def _phys_row(r, p, phys_dup, phys_match, pair_by_sap, tie_of_phys, out) -> PhysicalRow:
    notes: list[Note] = []
    match = phys_match.get(r)
    g = tie_of_phys.get(r)
    confidence = None
    matched_sap = None
    if r in phys_dup:
        status = MatchStatus.DUPLICATE
        notes.append(note("physical_duplicate", first=phys_dup[r]))
        out.append(
            Discrepancy.of(
                DiscrepancyKind.DUPLICATE, notes[-1], physical_row=r, asset_id=p["asset_id"]
            )
        )
    elif p["_defective"]:
        status = MatchStatus.DEFECTIVE
        notes.append(note("defective_excluded"))
    elif p["sap_type"] is None:
        status = MatchStatus.UNCLASSIFIED
        notes.append(note("unclassified_note"))
        msg = note("unclassified", item=p["item_name"], description=p["description"])
        out.append(
            Discrepancy.of(
                DiscrepancyKind.UNCLASSIFIED, msg, physical_row=r, asset_id=p["asset_id"]
            )
        )
    elif g is not None and (match is None or match[1]) and g.pending_slots:
        status, confidence = MatchStatus.NEEDS_DECISION, Confidence.NEEDS_DECISION
        matched_sap = match[0] if match else None
        notes.append(note("tie_candidate", group=g.group_id))
    elif match is not None:
        sr, _ = match
        pair = pair_by_sap[sr]
        matched_sap, confidence = sr, pair.confidence
        if g is not None:
            status = MatchStatus.MANUAL
        elif pair.location_mismatch:
            status = MatchStatus.LOCATION_MISMATCH
        else:
            status = MatchStatus.MATCHED
    else:
        status = MatchStatus.PHYSICAL_ONLY
        if g is not None:
            notes.append(note("manual_left_physical"))
        msg = note("physical_only", sap_type=p["sap_type"], asset_id=p["asset_id"])
        out.append(
            Discrepancy.of(
                DiscrepancyKind.PHYSICAL_ONLY, msg, physical_row=r, asset_id=p["asset_id"]
            )
        )
    return PhysicalRow(
        excel_row=r,
        asset_id=p["asset_id"],
        item_name=p["item_name"],
        description=p["description"],
        color=p["color"],
        width_cm=p["width_cm"],
        size_word=p["size_word"],
        city=p["city"],
        building=p["building"],
        custodian=p["custodian"],
        activation_date=_date(p["activation_date"]),
        deactivation_date=_date(p["deactivation_date"]),
        gross_value=_float(p["gross_value"]),
        status=p["status"],
        sap_type=p["sap_type"],
        match_status=status,
        confidence=confidence,
        matched_sap_row=matched_sap,
        tie_group_id=g.group_id if g else None,
        duplicate_of=phys_dup.get(r),
        notes=notes,
    )


def _pair_flags(pair: Pair, p: dict, s: dict, out: list[Discrepancy]) -> None:
    if pair.provisional:
        return
    ref = {"physical_row": pair.physical_row, "sap_row": pair.sap_row, "asset_id": pair.asset_id}
    if pair.location_mismatch:
        msg = note("location_mismatch", city=p["city"], building=s["building"])
        out.append(Discrepancy.of(DiscrepancyKind.LOCATION_MISMATCH, msg, **ref))
    if p["deactivation_date"] is not None:
        out.append(Discrepancy.of(DiscrepancyKind.DEACTIVATED, note("deactivated"), **ref))
    if pair.year_gap:
        msg = note("year_gap", gap=pair.year_gap)
        out.append(Discrepancy.of(DiscrepancyKind.YEAR_GAP, msg, **ref))


def _summary(phys_rows, sap_rows, pairs, groups, decisions, cfg) -> Summary:
    return Summary(
        physical_total=len(phys_rows),
        sap_total=len(sap_rows),
        pairs=len(pairs),
        physical_status_counts=dict(Counter(r.match_status.value for r in phys_rows)),
        sap_status_counts=dict(Counter(r.match_status.value for r in sap_rows)),
        confidence_counts=dict(Counter(p.confidence.value for p in pairs)),
        location_mismatches=sum(p.location_mismatch for p in pairs),
        tie_groups=len(groups),
        tie_slots=sum(len(g.slots) for g in groups),
        tie_slots_pending=sum(g.pending_slots for g in groups),
        manual_decisions=len(decisions),
        rules_version=cfg.type_rules.version,
    )


def validate_tie_assignments(group: TieGroup, assignments: list[TieAssignment]) -> None:
    """Check a user's choices for one group: known slots, candidate IDs, one-to-one."""
    problems: list[dict] = []
    cand_ids = {c.asset_id for c in group.candidates}
    seen_rows: set[int] = set()
    seen_ids: Counter[str] = Counter()
    for a in assignments:
        if a.sap_row not in group.sap_rows:
            problems.append({"sap_row": a.sap_row, "problem": "not a slot of this tie group"})
        if a.sap_row in seen_rows:
            problems.append({"sap_row": a.sap_row, "problem": "assigned more than once"})
        seen_rows.add(a.sap_row)
        if a.physical_asset_id is not None:
            if a.physical_asset_id not in cand_ids:
                problems.append(
                    {"sap_row": a.sap_row, "problem": f"{a.physical_asset_id} is not a candidate"}
                )
            seen_ids[a.physical_asset_id] += 1
    for aid, n in seen_ids.items():
        if n > 1:
            problems.append({"asset_id": aid, "problem": "chosen for more than one SAP row"})
    # Keep previously decided slots that are not being changed in mind for one-to-one.
    changing = {a.sap_row for a in assignments}
    for slot in group.slots:
        if slot.decided and slot.sap_row not in changing and slot.chosen_asset_id in seen_ids:
            problems.append(
                {
                    "asset_id": slot.chosen_asset_id,
                    "problem": f"already chosen for SAP row {slot.sap_row}",
                }
            )
    if problems:
        raise TieDecisionError("The tie decision is not valid.", problems)


def accept_suggestions(
    result: ReconResult, group_ids: set[str] | None = None, now: dt.datetime | None = None
) -> list[ManualDecision]:
    """Existing decisions plus a decision confirming every pending suggestion (optionally
    only in ``group_ids``)."""
    now = now or dt.datetime.now(dt.UTC)
    added = [
        ManualDecision(
            group_id=g.group_id,
            sap_row=s.sap_row,
            asset_id=s.suggested_asset_id,
            proposed_asset_id=s.suggested_asset_id,
            decided_at=now,
        )
        for g in result.tie_groups
        if group_ids is None or g.group_id in group_ids
        for s in g.slots
        if not s.decided
    ]
    return list(result.decisions) + added
