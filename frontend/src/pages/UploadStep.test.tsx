import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { api, ApiError } from "../api/client";
import { sessionState } from "../test/fixtures";
import { UploadStep } from "./UploadStep";

afterEach(() => vi.restoreAllMocks());

function renderStep(props: Partial<Parameters<typeof UploadStep>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <UploadStep
        kind="original"
        state={sessionState()}
        match={undefined}
        ensureSession={async () => "s1"}
        onUploaded={() => {}}
        onContinue={() => {}}
        {...props}
      />
    </QueryClientProvider>,
  );
}

const file = () => new File(["x"], "book.xlsx");

test("several fitting sheets: the user picks one", async () => {
  const upload = vi
    .spyOn(api, "uploadOriginal")
    .mockRejectedValueOnce(
      new ApiError(422, "sheet_choice_required", "Pick the sheet.", [{ matching_sheets: ["Jan", "Feb"] }]),
    )
    .mockResolvedValueOnce({
      session_id: "s1",
      discarded_later_steps: false,
      original: {
        sheet: {
          file_name: "book.xlsx",
          sheet_name: "Feb",
          detected_by: "user_choice",
          sheets_available: ["Jan", "Feb"],
          row_count: 1,
          missing_optional_columns: [],
        },
        summary: { rows: 1, locations: [], duplicate_asset_ids: [], duplicate_rows: [], defective_rows: [], issues: [] },
      },
    });
  renderStep();
  await userEvent.upload(screen.getByLabelText("Original inventory (.xlsx / .xlsm)"), file());
  await userEvent.click(screen.getByRole("button", { name: "Upload" }));
  await userEvent.selectOptions(await screen.findByLabelText("Sheet"), "Feb");
  await userEvent.click(screen.getByRole("button", { name: "Use this sheet" }));
  await waitFor(() => expect(upload).toHaveBeenLastCalledWith("s1", expect.any(File), "Feb"));
});

test("replacing the original inventory asks for confirmation", async () => {
  const upload = vi.spyOn(api, "uploadOriginal").mockResolvedValue({} as never);
  const state = sessionState({
    original: {
      sheet: {
        file_name: "o.xlsx",
        sheet_name: "Munka1",
        detected_by: "header_signature",
        sheets_available: ["Munka1"],
        row_count: 84,
        missing_optional_columns: [],
      },
      summary: { rows: 84, locations: [], duplicate_asset_ids: [], duplicate_rows: [], defective_rows: [42], issues: [] },
    },
    incoming: {} as never,
    matched: true,
  });
  renderStep({ state });
  expect(screen.getByTestId("original-summary")).toHaveTextContent("o.xlsx › Munka1 (found by column headers) – 84 rows");
  await userEvent.click(screen.getByRole("button", { name: "Upload a different file" }));
  await userEvent.upload(screen.getByLabelText("Original inventory (.xlsx / .xlsm)"), file());
  await userEvent.click(screen.getByRole("button", { name: "Upload" }));
  expect(screen.getByRole("alertdialog")).toHaveTextContent(
    "The incoming list and every decision made so far will be discarded.",
  );
  expect(upload).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Replace" }));
  expect(upload).toHaveBeenCalled();
});

test("the missing columns of a rejected file are listed", async () => {
  vi.spyOn(api, "uploadIncoming").mockRejectedValue(
    new ApiError(422, "missing_columns", "SAP_Export is missing Serial No.", [
      { sheet: "Export", missing_columns: ["Serial No."] },
    ]),
  );
  renderStep({ kind: "incoming" });
  await userEvent.upload(screen.getByLabelText("Incoming furniture list (.xlsx / .xlsm)"), file());
  await userEvent.click(screen.getByRole("button", { name: "Upload" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Export: missing Serial No.");
});
