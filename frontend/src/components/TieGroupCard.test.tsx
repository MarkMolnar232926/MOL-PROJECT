import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { tieGroup } from "../test/fixtures";
import { TieGroupCard } from "./TieGroupCard";
import { initialDraft, optionsFor } from "./tieOptions";

const optionValues = (select: HTMLElement) =>
  within(select).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);

describe("tie options", () => {
  test("a unit chosen by one slot is not offered to the others", () => {
    const g = tieGroup();
    const draft = initialDraft(g);
    expect(draft).toEqual({ 3: "84214252", 69: "84236836", 75: "84298003" });
    expect(optionsFor(g, draft, 3).map((c) => c.asset_id)).toEqual(["84214252"]);
    const freed = { ...draft, 69: null };
    expect(optionsFor(g, freed, 3).map((c) => c.asset_id)).toEqual(["84214252", "84236836"]);
  });

  test("decided slots start from the chosen unit", () => {
    const g = tieGroup();
    g.slots[0] = { ...g.slots[0], decided: true, chosen_asset_id: null };
    expect(initialDraft(g)[3]).toBeNull();
  });
});

describe("TieGroupCard", () => {
  test("options shrink as IDs are chosen and saving sends the whole group", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<TieGroupCard group={tieGroup()} onSave={onSave} onReset={() => {}} />);
    const first = screen.getByLabelText("Physical unit for SAP SN-2021-3808");
    const second = screen.getByLabelText("Physical unit for SAP SN-2021-4894");
    // Every slot holds its suggestion, so each dropdown offers "none" + its own unit only.
    expect(optionValues(first)).toEqual(["", "84214252"]);
    expect(optionValues(second)).toEqual(["", "84236836"]);

    await user.selectOptions(second, "");
    expect(optionValues(first)).toEqual(["", "84214252", "84236836"]);
    await user.selectOptions(first, "84236836");
    expect(optionValues(second)).toEqual(["", "84214252"]);
    // 84214252 was freed by the first slot, so the third slot may now take it.
    expect(optionValues(screen.getByLabelText("Physical unit for SAP SN-2021-3498"))).toEqual([
      "",
      "84298003",
      "84214252",
    ]);

    await user.click(screen.getByRole("button", { name: "Save choices" }));
    expect(onSave).toHaveBeenCalledWith([
      { sap_row: 3, physical_asset_id: "84236836" },
      { sap_row: 69, physical_asset_id: null },
      { sap_row: 75, physical_asset_id: "84298003" },
    ]);
  });

  test("accept suggestion and reset", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onReset = vi.fn();
    render(<TieGroupCard group={tieGroup()} onSave={onSave} onReset={onReset} />);
    expect(screen.getAllByText("suggested")).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Accept suggestion" }));
    expect(onSave).toHaveBeenCalledWith([
      { sap_row: 3, physical_asset_id: "84214252" },
      { sap_row: 69, physical_asset_id: "84236836" },
      { sap_row: 75, physical_asset_id: "84298003" },
    ]);
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(onReset).toHaveBeenCalled();
  });
});
