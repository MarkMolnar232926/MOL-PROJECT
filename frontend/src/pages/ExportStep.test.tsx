import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "../api/client";
import { result, row } from "../test/fixtures";
import { ExportStep, exportName } from "./ExportStep";

afterEach(() => vi.restoreAllMocks());

const props = { sessionId: "s1", incomingName: "sap_export.xlsx", onQueue: () => {}, onStartOver: () => {} };

test("the export file name follows the uploaded one", () => {
  expect(exportName("sap_export.xlsx")).toBe("sap_export_asset_id.xlsx");
  expect(exportName("macro.XLSM")).toBe("macro_asset_id.xlsm");
});

test("export stays disabled until every item is resolved", async () => {
  const onQueue = vi.fn();
  render(<ExportStep {...props} result={result([row(2, "auto", "1"), row(3, "no_candidate")])} onQueue={onQueue} />);
  expect(screen.getByRole("button", { name: "Download file" })).toBeDisabled();
  expect(screen.getByTestId("export-remaining")).toHaveTextContent("1 item left");
  expect(screen.getByTestId("guide")).toHaveTextContent("1 item still needs a decision");
  await userEvent.click(screen.getByRole("button", { name: /Go to the items to resolve/ }));
  expect(onQueue).toHaveBeenCalled();
});

test("a resolved session downloads the file and says so", async () => {
  const exp = vi
    .spyOn(api, "exportWorkbook")
    .mockResolvedValue({ blob: new Blob(["x"]), filename: "sap_export_asset_id.xlsx" });
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  render(<ExportStep {...props} result={result([row(2, "auto", "1"), row(3, "no_match")])} />);
  expect(screen.getByText("sap_export_asset_id.xlsx")).toBeInTheDocument();
  expect(screen.getByTestId("export-filled")).toHaveTextContent("1");
  await userEvent.click(screen.getByRole("button", { name: "Download file" }));
  expect(exp).toHaveBeenCalledWith("s1");
  expect(await screen.findByTestId("export-done")).toHaveTextContent("sap_export_asset_id.xlsx has been saved");
  expect(screen.getByRole("button", { name: "Download again" })).toBeEnabled();
});
