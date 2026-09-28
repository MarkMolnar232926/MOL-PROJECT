import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "../api/client";
import { result, row } from "../test/fixtures";
import { ExportStep } from "./ExportStep";

afterEach(() => vi.restoreAllMocks());

test("export stays disabled until every item is resolved", async () => {
  const onQueue = vi.fn();
  render(<ExportStep sessionId="s1" result={result([row(2, "auto"), row(3, "no_candidate")])} onQueue={onQueue} />);
  expect(screen.getByRole("button", { name: "Download file" })).toBeDisabled();
  expect(screen.getByTestId("export-remaining")).toHaveTextContent("1 item left");
  await userEvent.click(screen.getByRole("button", { name: "Go to the items to resolve" }));
  expect(onQueue).toHaveBeenCalled();
});

test("a resolved session downloads the file", async () => {
  const exp = vi
    .spyOn(api, "exportWorkbook")
    .mockResolvedValue({ blob: new Blob(["x"]), filename: "sap_export_asset_id.xlsx" });
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  render(<ExportStep sessionId="s1" result={result([row(2, "auto"), row(3, "no_match")])} onQueue={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: "Download file" }));
  expect(exp).toHaveBeenCalledWith("s1");
});
