import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, type SessionState } from "./api/client";
import App from "./App";
import { I18nProvider } from "./i18n";
import { result, row, sessionState } from "./test/fixtures";

const sheet = (name: string) => ({
  file_name: name,
  sheet_name: "Munka1",
  detected_by: "header_signature" as const,
  sheets_available: ["Munka1"],
  row_count: 2,
  missing_optional_columns: [],
});
const uploaded: SessionState = sessionState({
  original: {
    sheet: sheet("physical_inventory.xlsx"),
    summary: { rows: 2, locations: [], duplicate_asset_ids: [], duplicate_rows: [], defective_rows: [], issues: [] },
  },
  incoming: {
    sheet: sheet("sap_export.xlsx"),
    summary: { rows: 2, locations: [], item_types: 1, duplicate_rows: [], prefilled_asset_ids: [], issues: [] },
  },
  matched: false,
});

beforeEach(() => {
  window.sessionStorage.setItem("recon.sessionId", "s1");
  vi.spyOn(api, "health").mockResolvedValue({ status: "ok" });
});
afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nProvider initial="en">
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

test("matching starts only when the user opens the Matching step", async () => {
  let state = uploaded;
  vi.spyOn(api, "state").mockImplementation(async () => state);
  const res = result([row(2, "auto", "1"), row(3, "no_candidate")]);
  const match = vi.spyOn(api, "match").mockImplementation(async () => {
    state = { ...uploaded, matched: true };
    return res;
  });
  vi.spyOn(api, "result").mockResolvedValue(res);
  renderApp();

  // both files are in: the app waits on step 2 and has not matched anything
  expect(await screen.findByTestId("incoming-summary")).toBeInTheDocument();
  expect(screen.getByTestId("step-matching")).toBeEnabled();
  expect(screen.getByTestId("step-export")).toBeDisabled();
  expect(match).not.toHaveBeenCalled();

  await userEvent.click(screen.getAllByRole("button", { name: /Start the matching/ })[0]);
  expect(await screen.findByTestId("matching-run")).toHaveTextContent("Matching in progress");
  await waitFor(() => expect(match).toHaveBeenCalledTimes(1));
  expect(await screen.findByTestId("match-reveal", {}, { timeout: 3000 })).toHaveTextContent(
    "1 of 2 items were matched automatically",
  );
  expect(screen.getByTestId("next-step-status")).toHaveTextContent("1 of 2 resolved – 1 item still needs your decision");
  expect(screen.getByRole("button", { name: /Continue to export/ })).toBeDisabled();
});
