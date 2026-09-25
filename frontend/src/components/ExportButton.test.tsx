import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ExportButton } from "./ExportButton";

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response("xlsx", {
      status: 200,
      headers: { "Content-Disposition": 'attachment; filename="reconciled_1.xlsx"' },
    }),
  );
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

test("asks for confirmation while tie slots are pending", async () => {
  const user = userEvent.setup();
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(<ExportButton sessionId="s1" pendingSlots={3} />);
  await user.click(screen.getByRole("button", { name: "Export Excel" }));
  const dialog = screen.getByRole("alertdialog");
  expect(dialog).toHaveTextContent("3 tie slots still need a decision — export anyway?");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Export Excel" }));
  await user.click(screen.getByRole("button", { name: "Export anyway" }));
  expect(fetch).toHaveBeenCalledWith("/api/sessions/s1/export");
  await vi.waitFor(() => expect(click).toHaveBeenCalled());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("exports straight away when nothing is pending", async () => {
  const user = userEvent.setup();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(<ExportButton sessionId="s1" pendingSlots={0} />);
  await user.click(screen.getByRole("button", { name: "Export Excel" }));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith("/api/sessions/s1/export");
});

test("is disabled without a session", () => {
  render(<ExportButton sessionId={null} pendingSlots={0} />);
  expect(screen.getByRole("button", { name: "Export Excel" })).toBeDisabled();
});
