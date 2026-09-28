"""Score-based matching, the newest-date tie-break (3.2), candidates and decisions."""

import datetime as dt

import pytest
from conftest import (
    INCOMING_FILE,
    ORIGINAL_FILE,
    PHYSICAL_HEADERS,
    SAP_HEADERS,
    build_workbook,
    phys,
    sap,
)

from recon import InputFile, default_config
from recon.intake import read_upload
from recon.match_models import Criterion, LogAction, NoMatchReason, RowStatus
from recon.matching import AssignmentError, Matching, SwapRequiredError, UnknownRowError

NOW = dt.datetime(2026, 1, 1, tzinfo=dt.UTC)


def make(physical_rows, sap_rows, cfg=None) -> Matching:
    cfg = cfg or default_config()
    o = build_workbook({"Stock": [PHYSICAL_HEADERS, *physical_rows]})
    i = build_workbook({"Export": [SAP_HEADERS, *sap_rows]})
    return Matching(
        read_upload(InputFile("o.xlsx", o), "physical", cfg=cfg),
        read_upload(InputFile("i.xlsx", i), "sap", cfg=cfg),
        cfg,
    )


def rows(m: Matching):
    return {r.item.excel_row: r for r in m.result().rows}


def pairs(m: Matching):
    return {r: x.asset_id for r, x in rows(m).items() if x.asset_id}


# --- golden: the sample files ---------------------------------------------------------------

# incoming row -> (Asset ID, status). Rows 14 and 20 have no candidate.
EXPECTED = {
    2: ("84236836", RowStatus.AUTO_NEWEST),  # Work Desk 120 LKS: newest of three
    3: ("84253126", RowStatus.AUTO),
    4: ("84243715", RowStatus.AUTO),
    5: ("84243853", RowStatus.AUTO_NEWEST),  # Computer Desk RVS: newest of three RVS
    6: ("84296838", RowStatus.AUTO_NEWEST),  # Work Desk 160 LKS: newest of two
    7: ("84273288", RowStatus.AUTO_NEWEST),  # Dining Table: the RVS unit, rows 7/8 compete
    8: ("84261222", RowStatus.LOCATION_MISMATCH),  # newer of the two LKS units
    9: ("84278075", RowStatus.AUTO),
    10: ("84277502", RowStatus.AUTO_NEWEST),
    11: ("84255862", RowStatus.AUTO_NEWEST),
    12: ("84203792", RowStatus.AUTO),
    13: ("84235250", RowStatus.AUTO_NEWEST),
    14: (None, RowStatus.NO_CANDIDATE),  # the only RVS Writing Desk is defective
    15: ("84282058", RowStatus.AUTO_NEWEST),
    16: ("84285415", RowStatus.LOCATION_MISMATCH),  # the LKS Computer Desk goes last
    17: ("84214252", RowStatus.AUTO_NEWEST),
    18: ("84298003", RowStatus.AUTO_NEWEST),
    19: ("84205455", RowStatus.AUTO_NEWEST),  # rows 19/20 compete for one unit
    20: (None, RowStatus.NO_CANDIDATE),
    21: ("84200684", RowStatus.AUTO),
}


@pytest.fixture(scope="module")
def sample():
    if not (ORIGINAL_FILE.exists() and INCOMING_FILE.exists()):
        pytest.skip("sample files missing from tests/fixtures")
    return Matching(
        read_upload(InputFile(ORIGINAL_FILE.name, ORIGINAL_FILE.read_bytes()), "physical"),
        read_upload(InputFile(INCOMING_FILE.name, INCOMING_FILE.read_bytes()), "sap"),
    )


def test_sample_expected_result(sample):
    got = {r: (x.asset_id, x.status) for r, x in rows(sample).items()}
    assert got == EXPECTED


def test_sample_summary(sample):
    s = sample.result().summary
    assert (s.incoming_rows, s.resolved, s.unresolved) == (20, 18, 2)
    assert s.status_counts == {
        "auto": 5,
        "auto_newest": 11,
        "location_mismatch": 2,
        "manual": 0,
        "no_match": 0,
        "no_candidate": 2,
        "duplicate": 0,
    }
    assert s.location_mismatches == 2
    assert s.existing_units == 81  # 84 rows minus 3 double entries
    assert s.unpaired_existing == 81 - 7 - 18  # minus defective, minus paired
    assert s.export_ready is False


def test_sample_newest_date_rule(sample):
    r = rows(sample)
    units = sample.unit_by_id
    for group in ([2, 17, 18], [6, 11], [5, 13, 15]):
        dates = [units[r[row].asset_id].activation_date for row in group]
        assert dates == sorted(dates, reverse=True), group  # file order gets newest first


def test_sample_defective_units_are_not_auto_candidates(sample):
    paired = {x.asset_id for x in rows(sample).values()}
    assert not paired & {u.asset_id for u in sample.units if u.defective}
    cands = sample.candidates(14)
    assert cands == []  # the only free RVS/LKS Writing Desk left is defective
    cands = sample.candidates(14, include_defective=True)
    assert [c.existing.asset_id for c in cands] == ["84268852"]
    assert cands[0].existing.defective and cands[0].hard_ok


def test_sample_warnings_on_rows(sample):
    r = rows(sample)
    assert [n.code for n in r[21].notes] == ["deactivated"]
    assert "location_mismatch" in [n.code for n in r[16].notes]
    assert [n.code for n in r[20].notes] == ["no_candidate"]


# --- scoring --------------------------------------------------------------------------------


def test_score_leaves_out_what_cannot_be_judged():
    m = make(
        [phys(1, "table", "desk with monitor shelf and cable tray, oak", "Riverside")],
        [sap("Computer Desk", "Oak", 120, "SN-2024-1", "LKS")],
    )
    (c,) = m.candidates(2)
    judged = {x.criterion: x.match for x in c.checks if x.evaluable}
    # no size in the description; "oak" is found as a material and agrees with "Wood" (synonym)
    assert judged == {
        Criterion.TYPE: True,
        Criterion.COLOR: True,
        Criterion.LOCATION: False,
        Criterion.MATERIAL: True,
    }
    assert c.score == pytest.approx(100 * 60 / 70, abs=0.01)


def test_hard_constraints_block_automatic_pairs():
    m = make(
        [
            phys(1, "chair", "on wheels, 60cm wide, black"),
            phys(2, "chair", "on wheels, 60cm wide, grey"),
        ],
        [sap("Swivel Chair", "Black", 70, "SN-1"), sap("Swivel Chair", "Grey", 60, "SN-2")],
    )
    assert pairs(m) == {3: "2"}
    assert rows(m)[2].status is RowStatus.NO_CANDIDATE


def test_size_word_uses_widths_of_the_same_type_and_location():
    m = make(
        [
            phys(1, "stool", "footstool, small, beige", "Riverside"),
            phys(2, "stool", "footstool, large, beige", "Riverside"),
        ],
        [
            sap("Footstool", "Beige", 60, "SN-1", "RVS"),
            sap("Footstool", "Beige", 40, "SN-2", "RVS"),
            sap("Footstool", "Beige", 20, "SN-3", "LKS"),
        ],
    )
    assert pairs(m) == {2: "2", 3: "1"}


# --- rule 3.2 -------------------------------------------------------------------------------


def chairs(dates, city="Riverside", start=11111111):
    return [phys(start + i, "chair", "on wheels, black", city, d) for i, d in enumerate(dates)]


def test_equal_scores_newest_date_goes_to_the_first_row():
    m = make(
        chairs([(2019, 1, 1), (2023, 1, 1), (2021, 1, 1)]),
        [sap("Swivel Chair", "Black", 60, f"SN-{i}") for i in range(3)],
    )
    assert pairs(m) == {2: "11111112", 3: "11111113", 4: "11111111"}
    assert all(x.status is RowStatus.AUTO_NEWEST for x in rows(m).values())


def test_fewer_rows_than_units_take_the_newest():
    m = make(
        chairs([(2019, 1, 1), (2023, 1, 1), (2021, 1, 1)]),
        [sap("Swivel Chair", "Black", 60, f"SN-{i}") for i in range(2)],
    )
    assert pairs(m) == {2: "11111112", 3: "11111113"}
    assert [u.asset_id for u in m.result().unpaired_existing] == ["11111111"]


def test_more_rows_than_units_leave_the_last_rows_open():
    # (different serials: identical rows would be duplicates)
    m = make(
        chairs([(2019, 1, 1)]),
        [sap("Swivel Chair", "Black", 60, "SN-1"), sap("Swivel Chair", "Black", 60, "SN-2")],
    )
    assert pairs(m) == {2: "11111111"}
    r = rows(m)
    assert r[2].status is RowStatus.AUTO_NEWEST  # decided by file order
    assert r[3].status is RowStatus.NO_CANDIDATE


def one_point_config():
    """Weights where a location mismatch costs exactly one point: 100 vs 99."""
    cfg = default_config().model_copy(deep=True)
    w = cfg.scoring.weights
    w.type, w.color, w.location = 49, 50, 1
    return cfg


def test_tie_break_never_beats_a_real_score_difference():
    m = make(
        [
            phys(1, "chair", "on wheels, black", "Riverside", (2010, 1, 1)),  # older, 100
            phys(2, "chair", "on wheels, black", "Lakeside", (2025, 1, 1)),  # newer, 99
        ],
        [sap("Swivel Chair", "Black", 60, "SN-1", "RVS")],
        one_point_config(),
    )
    scores = {c.existing.asset_id: c.score for c in m.candidates(2)}
    assert scores == {"1": 100, "2": 99}
    assert pairs(m) == {2: "1"}


@pytest.mark.parametrize("n", [2, 10, 40])
def test_tie_break_is_subordinate_whatever_the_group_size(n):
    """n rows compete; one old unit scores one point more than n newer ones."""
    physical = [phys(1, "chair", "on wheels, black", "Riverside", (2000, 1, 1))] + [
        phys(100 + i, "chair", "on wheels, black", "Lakeside", (2020 + i, 1, 1)) for i in range(n)
    ]
    incoming = [sap("Swivel Chair", "Black", 60, f"SN-{i}", "RVS") for i in range(n)]
    m = make(physical, incoming, one_point_config())
    got = pairs(m)
    assert len(got) == n
    assert got[2] == "1"  # the first row takes the better-scoring, older unit
    # the rest take the newer units, newest first
    assert [got[r] for r in range(3, n + 2)] == [str(100 + i) for i in reversed(range(1, n))]


# --- incoming duplicates --------------------------------------------------------------------


def test_duplicate_incoming_rows_need_a_decision():
    row = sap("Swivel Chair", "Black", 60, "SN-1")
    m = make(chairs([(2019, 1, 1), (2020, 1, 1)]), [row, list(row)])
    r = rows(m)
    assert r[2].asset_id == "11111112"
    assert r[3].status is RowStatus.DUPLICATE and not r[3].resolved
    assert r[3].item.duplicate_of == 2
    assert [n.code for n in r[3].notes] == ["incoming_duplicate"]


def test_duplicate_existing_rows_are_one_candidate():
    unit = phys(11111111, "chair", "on wheels, black")
    m = make([unit, list(unit)], [sap("Swivel Chair", "Black", 60, "SN-1")])
    assert [c.existing.excel_row for c in m.candidates(2)] == [2]


# --- candidates -----------------------------------------------------------------------------


def candidate_setup():
    return make(
        [
            *chairs([(2019, 1, 1), (2020, 1, 1)]),
            phys(33333333, "table", "office desk with 4 drawers, oak", date=(2021, 1, 1)),
            phys(
                44444444,
                "chair",
                "on wheels, black",
                date=(2022, 1, 1),
                status="Defective - pending write-off",
            ),
        ],
        [
            sap("Swivel Chair", "Black", 60, "SN-1"),
            sap("Swivel Chair", "Black", 60, "SN-2", qr="INV0033333333"),
            sap("Swivel Chair", "Black", 60, "SN-3"),
        ],
    )


def test_candidate_filters():
    m = candidate_setup()
    assert pairs(m) == {2: "11111112", 3: "11111111"}
    ids = lambda **kw: [c.existing.asset_id for c in m.candidates(4, **kw)]  # noqa: E731
    # row 4 is open; the qr code of row 3 does not matter here
    assert ids() == []  # both free chairs are taken, the defective one is hidden
    assert ids(include_paired=True) == ["11111112", "11111111"]
    assert ids(include_defective=True) == ["44444444"]
    assert ids(include_other_types=True) == ["33333333"]
    assert ids(include_paired=True, q="1112") == ["11111112"]
    paired = {c.existing.asset_id: c.paired_row for c in m.candidates(4, include_paired=True)}
    assert paired == {"11111112": 2, "11111111": 3}


def test_qr_match_is_tagged_and_first():
    m = candidate_setup()
    cands = m.candidates(3)
    assert cands[0].existing.asset_id == "33333333" and cands[0].qr_match
    assert not cands[0].hard_ok  # a table: shown because of the QR code, never auto-matched
    assert [c.existing.asset_id for c in cands[1:]] == ["11111111"]


def test_search_text_covers_description_and_custodian():
    m = candidate_setup()
    got = m.candidates(4, include_paired=True, include_other_types=True, q="tester")
    assert len(got) == 3  # every unit has custodian "Tester"; defective still hidden
    got = m.candidates(4, include_other_types=True, q="4 DRAWERS")
    assert [c.existing.asset_id for c in got] == ["33333333"]


# --- decisions ------------------------------------------------------------------------------


def test_manual_assignment_of_a_free_unit():
    m = make(
        chairs([(2019, 1, 1), (2020, 1, 1), (2021, 1, 1)]),
        [sap("Swivel Chair", "Black", 60, "SN-1")],
    )
    assert pairs(m) == {2: "11111113"}
    assert m.assign(2, "11111111", now=NOW) is None
    r = rows(m)[2]
    assert (r.asset_id, r.status, r.auto_asset_id) == ("11111111", RowStatus.MANUAL, "11111113")
    (entry,) = m.result().log
    assert (entry.row, entry.action, entry.old_asset_id, entry.new_asset_id) == (
        2,
        LogAction.ASSIGN,
        "11111113",
        "11111111",
    )


def test_swap_needs_confirmation_and_releases_the_other_row():
    m = make(
        chairs([(2019, 1, 1), (2020, 1, 1)]),
        [sap("Swivel Chair", "Black", 60, "SN-1"), sap("Swivel Chair", "Black", 60, "SN-2")],
    )
    assert pairs(m) == {2: "11111112", 3: "11111111"}
    with pytest.raises(SwapRequiredError) as err:
        m.assign(2, "11111111", now=NOW)
    assert err.value.details[0]["row"] == 3
    assert pairs(m) == {2: "11111112", 3: "11111111"}  # nothing changed

    assert m.assign(2, "11111111", confirm_swap=True, now=NOW) == 3
    r = rows(m)
    assert (r[2].asset_id, r[2].status) == ("11111111", RowStatus.MANUAL)
    assert (r[3].asset_id, r[3].status, r[3].resolved) == (None, RowStatus.NO_CANDIDATE, False)
    assert [n.code for n in r[3].notes] == ["released_by_swap"]
    assert [(e.row, e.action) for e in m.result().log] == [
        (3, LogAction.RELEASED),
        (2, LogAction.ASSIGN),
    ]
    # one-to-one holds: every Asset ID at most once
    held = [a for a in pairs(m).values()]
    assert len(held) == len(set(held))


def test_no_pair_needs_a_reason_and_other_needs_a_note():
    m = make(chairs([(2019, 1, 1)]), [sap("Swivel Chair", "Black", 60, "SN-1")])
    with pytest.raises(AssignmentError):
        m.assign(2, None)
    with pytest.raises(AssignmentError):
        m.assign(2, None, NoMatchReason.OTHER, "  ")
    m.assign(2, None, NoMatchReason.OTHER, "label says 2nd floor", now=NOW)
    r = rows(m)[2]
    assert (r.status, r.asset_id, r.resolved) == (RowStatus.NO_MATCH, None, True)
    assert (r.reason, r.note) == (NoMatchReason.OTHER, "label says 2nd floor")
    assert [u.asset_id for u in m.result().unpaired_existing] == ["11111111"]


def test_unknown_asset_and_row():
    m = make(chairs([(2019, 1, 1)]), [sap("Swivel Chair", "Black", 60, "SN-1")])
    with pytest.raises(AssignmentError):
        m.assign(2, "99999999")
    with pytest.raises(UnknownRowError):
        m.assign(9, None, NoMatchReason.NEW)


def test_reset_restores_the_automatic_pair():
    m = make(
        chairs([(2019, 1, 1), (2020, 1, 1)]),
        [sap("Swivel Chair", "Black", 60, "SN-1"), sap("Swivel Chair", "Black", 60, "SN-2")],
    )
    m.assign(2, "11111111", confirm_swap=True, now=NOW)  # row 3 released
    # row 3 wants its automatic unit back, which row 2 now holds
    with pytest.raises(SwapRequiredError):
        m.reset(3)
    m.reset(2, now=NOW)  # row 2 back to its own automatic unit 11111112
    assert rows(m)[2].status is RowStatus.AUTO_NEWEST
    m.reset(3, now=NOW)
    assert pairs(m) == {2: "11111112", 3: "11111111"}
    assert m.result().summary.export_ready


def test_duplicate_row_can_be_closed_with_a_reason():
    row = sap("Swivel Chair", "Black", 60, "SN-1")
    m = make(chairs([(2019, 1, 1)]), [row, list(row)])
    assert not m.result().summary.export_ready
    m.assign(3, None, NoMatchReason.DUPLICATE, now=NOW)
    assert rows(m)[3].status is RowStatus.NO_MATCH
    assert m.result().summary.export_ready
