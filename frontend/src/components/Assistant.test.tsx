import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, ApiError, type SessionResult } from "../api/client";
import { candidate, result, row } from "../test/fixtures";
import { Assistant, nextUnresolved } from "./Assistant";

const START = result([row(2, "auto_newest", "84236836"), row(3, "no_candidate"), row(4, "duplicate")]);

function Harness({ initial }: { initial: SessionResult }) {
  const [queue, setQueue] = useState([3, 4]);
  const [current, setCurrent] = useState<number | null>(null);
  return (
    <Assistant
      sessionId="s1"
      result={initial}
      queue={queue}
      setQueue={setQueue}
      current={current}
      setCurrent={setCurrent}
    />
  );
}

function setup(initial = START) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["result", "s1"], initial);
  render(
    <QueryClientProvider client={client}>
      <Harness initial={initial} />
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  vi.spyOn(api, "candidates").mockResolvedValue([
    candidate("84214252", 100),
    candidate("84298003", 85.71, { paired_row: 5 }),
  ]);
});
afterEach(() => vi.restoreAllMocks());

const resolvedAfter = (r: number, assetId: string | null) =>
  result([
    row(2, "auto_newest", "84236836"),
    r === 3 ? { ...row(3, assetId ? "manual" : "no_match", assetId) } : row(3, "no_candidate"),
    row(4, "duplicate"),
  ]);

test("next unresolved wraps around the queue", () => {
  const rows = new Map(START.rows.map((r) => [r.item.excel_row, r]));
  expect(nextUnresolved([2, 3, 4], rows, 4)).toBe(3);
  expect(nextUnresolved([2, 3, 4], rows, null)).toBe(3);
  expect(nextUnresolved([2], rows, 2)).toBe(null);
});

test("shows the queue, the item and ranked candidates with criteria", async () => {
  setup();
  expect(screen.getByTestId("queue-progress")).toHaveTextContent("0 / 2 resolved");
  expect(screen.getByTestId("item-card")).toHaveTextContent("Incoming row 3");
  const cards = await screen.findAllByTestId("candidate");
  expect(cards).toHaveLength(2);
  expect(cards[0]).toHaveTextContent("100%");
  expect(cards[0]).toHaveAttribute("aria-pressed", "true");
  expect(cards[0]).toHaveTextContent("✗ Location ✗: Riverside ≠ LKS");
  expect(cards[0]).toHaveTextContent("Material: not judged");
  expect(cards[1]).toHaveTextContent("Paired to row 5");
  expect(api.candidates).toHaveBeenCalledWith("s1", 3, expect.objectContaining({ includePaired: false }));
});

test("filters are sent to the server", async () => {
  setup();
  await screen.findAllByTestId("candidate");
  await userEvent.click(screen.getByLabelText("Show defective units"));
  await waitFor(() =>
    expect(api.candidates).toHaveBeenLastCalledWith("s1", 3, expect.objectContaining({ includeDefective: true })),
  );
});

test("arrow keys choose, Enter assigns and the next item opens", async () => {
  const assign = vi.spyOn(api, "assign").mockResolvedValue({
    row: 3,
    released_row: null,
    result: resolvedAfter(3, "84298003"),
  });
  const client = setup();
  await screen.findAllByTestId("candidate");
  await userEvent.keyboard("{ArrowDown}");
  expect(screen.getAllByTestId("candidate")[1]).toHaveAttribute("aria-pressed", "true");
  await userEvent.keyboard("{Enter}");
  expect(assign).toHaveBeenCalledWith("s1", 3, { asset_id: "84298003", confirm_swap: false });
  await waitFor(() => expect(screen.getByTestId("item-card")).toHaveTextContent("Incoming row 4"));
  expect((client.getQueryData(["result", "s1"]) as SessionResult).summary.resolved).toBe(2);
});

test("a swap asks first, then releases the other row", async () => {
  const assign = vi
    .spyOn(api, "assign")
    .mockRejectedValueOnce(
      new ApiError(409, "swap_required", "Asset ID 84298003 is assigned to row 5.", [
        { asset_id: "84298003", row: 5 },
      ]),
    )
    .mockResolvedValueOnce({ row: 3, released_row: 5, result: resolvedAfter(3, "84298003") });
  setup();
  const cards = await screen.findAllByTestId("candidate");
  await userEvent.click(cards[1]);
  await userEvent.click(screen.getByRole("button", { name: /^Assign/ }));
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog).toHaveTextContent(
    "Swap: 84298003 is assigned to row 5. Row 5 goes back to the items to resolve.",
  );
  await userEvent.click(within(dialog).getByRole("button", { name: "Swap" }));
  expect(assign).toHaveBeenLastCalledWith("s1", 3, { asset_id: "84298003", confirm_swap: true });
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
});

test("no pair needs a reason, and 'Other' needs a note", async () => {
  const assign = vi.spyOn(api, "assign").mockResolvedValue({
    row: 3,
    released_row: null,
    result: resolvedAfter(3, null),
  });
  setup();
  await screen.findAllByTestId("candidate");
  await userEvent.keyboard("n");
  const dialog = screen.getByRole("dialog", { name: "No existing pair" });
  const confirm = within(dialog).getByRole("button", { name: "Confirm" });
  expect(confirm).toBeDisabled();
  await userEvent.click(within(dialog).getByLabelText("Other"));
  expect(confirm).toBeDisabled();
  expect(dialog).toHaveTextContent("A note is required for 'Other'.");
  await userEvent.type(within(dialog).getByLabelText("Note"), "sold last year");
  await userEvent.click(confirm);
  expect(assign).toHaveBeenCalledWith("s1", 3, {
    asset_id: null,
    reason: "other",
    note: "sold last year",
    confirm_swap: false,
  });
});

test("Later moves the item to the end of the queue; J jumps to the next", async () => {
  setup();
  await screen.findAllByTestId("candidate");
  await userEvent.click(screen.getByRole("button", { name: "Later" }));
  expect(screen.getByTestId("item-card")).toHaveTextContent("Incoming row 4");
  expect(screen.getAllByTestId("queue-item").map((b) => b.textContent)).toEqual([
    expect.stringContaining("4"),
    expect.stringContaining("3"),
  ]);
  await userEvent.keyboard("j");
  expect(screen.getByTestId("item-card")).toHaveTextContent("Incoming row 3");
});

test("shortcuts work while a filter checkbox has focus, not while typing a search", async () => {
  setup();
  await screen.findAllByTestId("candidate");
  await userEvent.click(screen.getByLabelText("Show other types")); // focus stays on the checkbox
  await userEvent.keyboard("j");
  expect(screen.getByTestId("item-card")).toHaveTextContent("Incoming row 4");
  await userEvent.type(screen.getByPlaceholderText("Search Asset ID, description, custodian"), "j");
  expect(screen.getByTestId("item-card")).toHaveTextContent("Incoming row 4");
});

test("when changing a resolved item, its current pair is preselected", async () => {
  const initial = result([row(2, "auto_newest", "84298003"), row(3, "no_candidate")]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Open() {
    const [current, setCurrent] = useState<number | null>(2);
    return (
      <Assistant sessionId="s1" result={initial} queue={[3]} setQueue={() => {}} current={current} setCurrent={setCurrent} />
    );
  }
  render(
    <QueryClientProvider client={client}>
      <Open />
    </QueryClientProvider>,
  );
  expect(screen.getByText("You are changing a resolved item.")).toBeInTheDocument();
  const cards = await screen.findAllByTestId("candidate");
  expect(cards[1]).toHaveAttribute("aria-pressed", "true"); // 84298003, not the top-ranked one
});
