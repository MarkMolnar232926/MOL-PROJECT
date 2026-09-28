import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "../App";
import { en } from "./en";
import { hu } from "./hu";
import { I18nProvider, noteText } from "./index";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
  );
});
afterEach(() => vi.restoreAllMocks());

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nProvider>
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

test("switching to Hungarian is remembered", async () => {
  const user = userEvent.setup();
  const { unmount } = renderApp();
  expect(screen.getByRole("heading", { name: "Inventory Reconciliation" })).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("Language"), "hu");
  expect(screen.getByRole("heading", { name: "Leltáregyeztetés" })).toBeInTheDocument();
  expect(screen.getByLabelText("Nyelv")).toHaveValue("hu");
  expect(document.documentElement.lang).toBe("hu");
  expect(window.localStorage.getItem("recon.language")).toBe("hu");

  unmount();
  renderApp(); // a reload keeps the choice
  expect(screen.getByRole("heading", { name: "Leltáregyeztetés" })).toBeInTheDocument();
});

test("both languages know the same server values", () => {
  for (const group of ["status", "reasons", "criteria", "errors", "messages"] as const) {
    expect(Object.keys(hu[group]).sort()).toEqual(Object.keys(en[group]).sort());
  }
});

test("server messages are rendered from their code in the chosen language", () => {
  const n = { code: "location_mismatch", params: { city: "Riverside", building: "LKS" }, text: "" };
  expect(noteText(en, n)).toBe("The inventory says Riverside, the incoming list says LKS.");
  expect(noteText(hu, n)).toBe("A leltár szerint Riverside, a bejövő lista szerint LKS.");
  expect(noteText(hu, { code: "something_new", params: {}, text: "Fallback text." })).toBe("Fallback text.");
});
