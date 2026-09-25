import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { created, jsonResponse } from "../test/fixtures";
import { UploadPage } from "./UploadPage";

afterEach(() => vi.restoreAllMocks());

function renderPage(onUploaded = vi.fn(), onViewResults = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <UploadPage onUploaded={onUploaded} onViewResults={onViewResults} />
    </QueryClientProvider>,
  );
  return { onUploaded, onViewResults };
}

const xlsx = (name: string) => new File(["x"], name, { type: "application/vnd.ms-excel" });

test("one-workbook upload shows the detected sheets", async () => {
  const user = userEvent.setup();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(created, 201));
  const { onUploaded, onViewResults } = renderPage();
  const submit = screen.getByRole("button", { name: "Upload and reconcile" });
  expect(submit).toBeDisabled();
  await user.upload(screen.getByLabelText("Workbook (.xlsx / .xlsm)"), xlsx("book.xlsx"));
  expect(screen.getByText("Selected: book.xlsx")).toBeInTheDocument();
  await user.click(submit);

  expect(await screen.findByText("Detected sheets")).toBeInTheDocument();
  expect(screen.getByText(/Physical_Inventory \(by sheet name\), 84 rows/)).toBeInTheDocument();
  expect(screen.getByText("Optional columns not found: QR Code")).toBeInTheDocument();
  const [, init] = vi.mocked(fetch).mock.calls[0];
  expect((init?.body as FormData).get("workbook")).toBeInstanceOf(File);
  expect(onUploaded.mock.calls[0][0]).toEqual(created);
  await user.click(screen.getByRole("button", { name: "View results" }));
  expect(onViewResults).toHaveBeenCalled();
});

test("two-file mode sends physical and sap", async () => {
  const user = userEvent.setup();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(created, 201));
  renderPage();
  await user.click(screen.getByLabelText("Two files"));
  await user.upload(screen.getByLabelText("Physical_Inventory file"), xlsx("p.xlsx"));
  const submit = screen.getByRole("button", { name: "Upload and reconcile" });
  expect(submit).toBeDisabled();
  await user.upload(screen.getByLabelText("SAP_Export file"), xlsx("s.xlsx"));
  await user.click(submit);
  await screen.findByText("Detected sheets");
  const body = vi.mocked(fetch).mock.calls[0][1]?.body as FormData;
  expect([...body.keys()]).toEqual(["physical", "sap"]);
});

test("validation errors list the missing columns", async () => {
  const user = userEvent.setup();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse(
      {
        error: {
          code: "missing_columns",
          message: "SAP_Export is missing required column(s): Serial No.",
          details: [{ source: "sap", sheet: "SAP_Export", missing_columns: ["Serial No.", "Building"] }],
        },
      },
      422,
    ),
  );
  renderPage();
  await user.upload(screen.getByLabelText("Workbook (.xlsx / .xlsm)"), xlsx("bad.xlsx"));
  await user.click(screen.getByRole("button", { name: "Upload and reconcile" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("The upload could not be processed");
  expect(alert).toHaveTextContent("SAP_Export: missing Serial No., Building");
});
