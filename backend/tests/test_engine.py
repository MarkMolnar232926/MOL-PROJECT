import datetime as dt

import pytest
from conftest import make_input, phys, sap

from recon import default_config
from recon.engine import TieDecisionError, classify, reconcile, validate_tie_assignments
from recon.models import Confidence, DiscrepancyKind, ManualDecision, MatchStatus, TieAssignment

RULES = default_config().type_rules.rules
NOW = dt.datetime(2026, 1, 1)


def by_sap(result):
    return {r.excel_row: r for r in result.sap_rows}


def by_phys(result):
    return {r.excel_row: r for r in result.physical_rows}


def kinds(result):
    return [d.kind for d in result.discrepancies]


# --- classification -----------------------------------------------------------------------


def test_classify_first_rule_wins_and_empty_keyword():
    assert classify("chair", "office chair on wheels, black", RULES) == "Swivel Chair"
    assert classify("Table", "Office desk with 4 drawers, oak", RULES) == "Work Desk"
    assert classify("cabinet", "cabinet with 4 drawers, shoe rack, grey", RULES) == "Shoe Cabinet"
    assert classify("coat  rack", "anything, black", RULES) == "Coat Rack"
    assert classify("chair", "plastic, red", RULES) is None
    assert classify("lamp", "", RULES) is None


def test_unclassified_row_is_reported():
    res = reconcile(make_input([phys(1, "lamp", "desk lamp, red")], []))
    row = res.physical_rows[0]
    assert row.match_status is MatchStatus.UNCLASSIFIED
    assert kinds(res) == [DiscrepancyKind.UNCLASSIFIED]


# --- constraints --------------------------------------------------------------------------


def test_colour_and_explicit_width_are_hard_constraints():
    data = make_input(
        [phys(1, "chair", "on wheels, 60cm wide, black")],
        [
            sap("Swivel Chair", "Grey", 60, "SN-2020-1"),
            sap("Swivel Chair", "Black", 70, "SN-2020-2"),
            sap("Swivel Chair", "BLACK", 60, "SN-2020-3"),
        ],
    )
    res = reconcile(data)
    assert [(p.sap_row, p.asset_id) for p in res.pairs] == [(4, "1")]
    assert res.pairs[0].confidence is Confidence.HIGH


def test_size_word_uses_same_location_widths():
    data = make_input(
        [
            phys(1, "stool", "footstool, small, beige", "Riverside", (2022, 1, 1)),
            phys(2, "stool", "footstool, large, beige", "Riverside", (2022, 1, 1)),
        ],
        [
            sap("Footstool", "Beige", 60, "SN-2022-1", "RVS"),
            sap("Footstool", "Beige", 40, "SN-2022-2", "RVS"),
            sap("Footstool", "Beige", 20, "SN-2022-3", "LKS"),
        ],  # other site: ignored for sizing
    )
    res = reconcile(data)
    assert {p.asset_id: p.sap_row for p in res.pairs} == {"1": 3, "2": 2}
    assert res.summary.tie_groups == 0


def test_size_word_not_restrictive_with_one_width():
    data = make_input(
        [phys(1, "stool", "footstool, large, beige")], [sap("Footstool", "Beige", 40, "SN-2020-1")]
    )
    assert len(reconcile(data).pairs) == 1


def test_size_word_falls_back_to_all_locations():
    data = make_input(
        [phys(1, "stool", "footstool, small, beige", "Riverside")],
        [
            sap("Footstool", "Beige", 60, "SN-2020-1", "LKS"),
            sap("Footstool", "Beige", 40, "SN-2020-2", "LKS"),
        ],
    )
    res = reconcile(data)
    assert [(p.sap_row, p.location_mismatch) for p in res.pairs] == [(3, True)]
    assert res.sap_rows[0].match_status is MatchStatus.SAP_ONLY


# --- assignment ---------------------------------------------------------------------------


def test_fifo_by_year_and_location_preference():
    data = make_input(
        [
            phys(1, "bin", "bin, grey", "Riverside", (2021, 1, 1)),
            phys(2, "bin", "bin, grey", "Lakeside", (2019, 1, 1)),
            phys(3, "bin", "bin, grey", "Lakeside", (2020, 1, 1)),
        ],
        [
            sap("Trash Bin", "Grey", 30, "SN-2020-1", "LKS"),
            sap(
                "Trash Bin", "Grey", 30, "SN-2021-1", "LKS"
            ),  # the 2021 unit sits at the wrong site
            sap("Trash Bin", "Grey", 30, "SN-2019-1", "LKS"),
        ],
    )
    res = reconcile(data)
    assert {p.asset_id: p.sap_row for p in res.pairs} == {"3": 2, "1": 3, "2": 4}
    assert by_sap(res)[3].match_status is MatchStatus.LOCATION_MISMATCH
    assert DiscrepancyKind.LOCATION_MISMATCH in kinds(res)
    assert res.summary.tie_groups == 0


def test_tie_group_and_fifo_suggestion():
    data = make_input(
        [
            phys(1, "chair", "on wheels, black", date=(2019, 5, 1)),
            phys(2, "chair", "on wheels, black", date=(2019, 2, 1)),
        ],
        [
            sap("Swivel Chair", "Black", 60, "SN-2019-9000"),
            sap("Swivel Chair", "Black", 60, "SN-2019-1000"),
        ],
    )
    res = reconcile(data)
    (g,) = res.tie_groups
    assert (g.sap_type, g.year, g.locations, g.width_cm) == ("Swivel Chair", 2019, ["RVS"], 60)
    # oldest activation (asset 2) <-> lowest serial (row 3)
    assert {s.sap_row: s.suggested_asset_id for s in g.slots} == {3: "2", 2: "1"}
    assert all(r.match_status is MatchStatus.NEEDS_DECISION for r in res.sap_rows)
    assert all(r.asset_id is None for r in res.sap_rows)
    assert all(p.provisional for p in res.pairs)
    assert kinds(res).count(DiscrepancyKind.UNRESOLVED_TIE) == 2


def test_different_years_are_not_a_tie():
    data = make_input(
        [
            phys(1, "chair", "on wheels, black", date=(2019, 5, 1)),
            phys(2, "chair", "on wheels, black", date=(2020, 2, 1)),
        ],
        [
            sap("Swivel Chair", "Black", 60, "SN-2020-1"),
            sap("Swivel Chair", "Black", 60, "SN-2019-1"),
        ],
    )
    res = reconcile(data)
    assert res.summary.tie_groups == 0
    assert {p.asset_id: p.sap_row for p in res.pairs} == {"1": 3, "2": 2}
    assert {p.confidence for p in res.pairs} == {Confidence.HIGH}


def test_leftovers_on_both_sides():
    data = make_input([phys(1, "screen", "screen, blue")], [sap("Safe", "Grey", 50, "SN-2020-1")])
    res = reconcile(data)
    assert res.physical_rows[0].match_status is MatchStatus.PHYSICAL_ONLY
    assert res.sap_rows[0].match_status is MatchStatus.SAP_ONLY


# --- duplicates, exclusions, flags ------------------------------------------------------------


def test_duplicates_and_conflicting_ids():
    row = phys(1, "bin", "bin, grey")
    data = make_input(
        [row, list(row), phys(1, "bin", "bin, blue")],
        [
            sap("Trash Bin", "Grey", 30, "SN-2020-1", qr="INV0000000001"),
            sap("Trash Bin", "Grey", 30, "SN-2020-1", qr="INV0000000001"),
        ],
    )
    res = reconcile(data)
    assert by_phys(res)[3].match_status is MatchStatus.DUPLICATE
    assert by_phys(res)[3].duplicate_of == 2
    assert by_sap(res)[3].match_status is MatchStatus.DUPLICATE
    dq = [d for d in res.discrepancies if d.kind is DiscrepancyKind.DATA_QUALITY]
    assert len(dq) == 1 and "Asset ID 1" in dq[0].message


def test_defective_excluded_and_deactivated_flag():
    data = make_input(
        [
            phys(1, "bin", "bin, grey", status="defective - pending write-off"),
            phys(2, "bin", "bin, grey", deact=(2024, 1, 1)),
        ],
        [sap("Trash Bin", "Grey", 30, "SN-2020-1")],
    )
    res = reconcile(data)
    assert by_phys(res)[2].match_status is MatchStatus.DEFECTIVE
    assert res.pairs[0].asset_id == "2"
    assert DiscrepancyKind.DEACTIVATED in kinds(res)


def test_year_gap_flag():
    data = make_input(
        [phys(1, "bin", "bin, grey", date=(2019, 1, 1))],
        [sap("Trash Bin", "Grey", 30, "SN-2021-1")],
    )
    res = reconcile(data)
    assert res.pairs[0].year_gap == 2
    assert DiscrepancyKind.YEAR_GAP in kinds(res)


# --- QR codes ---------------------------------------------------------------------------------


def test_qr_codes_never_influence_matching():
    """Even a QR code that looks exactly like an Asset ID is only a label."""
    data = make_input(
        [
            phys(11111111, "chair", "on wheels, black", date=(2019, 5, 1)),
            phys(22222222, "chair", "on wheels, black", date=(2019, 2, 1)),
        ],
        [
            sap("Swivel Chair", "Black", 60, "SN-2019-9000", qr="INV0022222222"),
            sap("Swivel Chair", "Black", 60, "SN-2019-1000", qr="INV0011111111"),
        ],
    )
    res = reconcile(data)
    (g,) = res.tie_groups  # still a genuine tie
    # FIFO suggestion (oldest unit <-> lowest serial), regardless of what the QR codes say
    assert {s.sap_row: s.suggested_asset_id for s in g.slots} == {3: "22222222", 2: "11111111"}
    assert {s.sap_row: s.qr_code for s in g.slots} == {2: "INV0022222222", 3: "INV0011111111"}
    assert not any("QR" in n for r in res.sap_rows for n in r.notes)


def test_missing_qr_column_is_fine():
    data = make_input(
        [phys(1, "bin", "bin, grey")],
        [sap("Trash Bin", "Grey", 30, "SN-2020-1")],
        drop_sap=("QR Code",),
    )
    res = reconcile(data)
    assert res.sap_rows[0].qr_code is None and res.pairs[0].asset_id == "1"


# --- tie decisions --------------------------------------------------------------------------


def _three_desks():
    return make_input(
        [
            phys(1, "table", "office desk with 4 drawers, oak", "Lakeside", (2021, 1, 1)),
            phys(2, "table", "office desk with 4 drawers, oak", "Lakeside", (2021, 2, 1)),
            phys(3, "table", "office desk with 4 drawers, oak", "Lakeside", (2021, 3, 1)),
        ],
        [
            sap("Work Desk", "Oak", 120, f"SN-2021-{n}", "LKS", qr=f"INV00{n:08d}")
            for n in (1, 2, 3)
        ],
    )


def decide(group, sap_row, asset_id):
    return ManualDecision(
        group_id=group.group_id,
        sap_row=sap_row,
        asset_id=asset_id,
        proposed_asset_id=None,
        decided_at=NOW,
    )


def test_validate_one_to_one_candidates_and_slots():
    (g,) = reconcile(_three_desks()).tie_groups
    validate_tie_assignments(
        g,
        [
            TieAssignment(sap_row=2, physical_asset_id="3"),
            TieAssignment(sap_row=3, physical_asset_id=None),
        ],
    )
    bad = [
        [
            TieAssignment(sap_row=2, physical_asset_id="1"),
            TieAssignment(sap_row=3, physical_asset_id="1"),
        ],
        [TieAssignment(sap_row=2, physical_asset_id="99")],
        [TieAssignment(sap_row=50, physical_asset_id="1")],
    ]
    for assignments in bad:
        with pytest.raises(TieDecisionError):
            validate_tie_assignments(g, assignments)


def test_partial_decision_reflows_suggestions():
    data = _three_desks()
    (g,) = reconcile(data).tie_groups
    res = reconcile(data, decisions=[decide(g, 2, "3")])
    (g2,) = res.tie_groups
    slots = {s.sap_row: s for s in g2.slots}
    assert slots[2].decided and slots[2].chosen_asset_id == "3"
    assert {slots[3].suggested_asset_id, slots[4].suggested_asset_id} == {"1", "2"}
    assert g2.pending_slots == 2
    assert by_sap(res)[2].match_status is MatchStatus.MANUAL
    assert by_sap(res)[2].asset_id == "3"
    assert by_phys(res)[4].match_status is MatchStatus.MANUAL


def test_decision_none_leaves_rows_unmatched():
    data = _three_desks()
    (g,) = reconcile(data).tie_groups
    res = reconcile(data, decisions=[decide(g, 2, None), decide(g, 3, "1"), decide(g, 4, "2")])
    assert res.tie_groups[0].pending_slots == 0
    assert by_sap(res)[2].match_status is MatchStatus.SAP_ONLY
    assert by_phys(res)[4].match_status is MatchStatus.PHYSICAL_ONLY
    assert len(res.pairs) == 2


def test_decisions_survive_rerun_or_are_dropped_with_warning():
    data = _three_desks()
    (g,) = reconcile(data).tie_groups
    decisions = [decide(g, 2, "2")]
    again = reconcile(data, decisions=decisions)
    assert again.decisions == decisions and again.warnings == []
    stale = reconcile(data, decisions=[decide(g, 99, "1")])  # row 99 is not a tie slot
    assert stale.decisions == []
    assert any("row 99" in w for w in stale.warnings)
    invalid = reconcile(data, decisions=[decide(g, 2, "99")])
    assert invalid.decisions == [] and invalid.warnings
