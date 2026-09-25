import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "../App";
import { TieGroupCard } from "../components/TieGroupCard";
import { tieGroup } from "../test/fixtures";
import { en } from "./en";
import { hu } from "./hu";
import { discrepancyText, I18nProvider, noteText } from "./index";

beforeEach(() => {
  window.localStorage.clear();
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

test("switching to Hungarian translates the app and is remembered", async () => {
  const user = userEvent.setup();
  const { unmount } = renderApp();
  expect(screen.getByRole("heading", { name: "Inventory Reconciliation" })).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("Language"), "hu");
  expect(screen.getByRole("heading", { name: "Leltáregyeztetés" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Feltöltés" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Feltöltés és egyeztetés" })).toBeInTheDocument();
  expect(screen.getByLabelText("Nyelv")).toHaveValue("hu");
  expect(document.documentElement.lang).toBe("hu");
  expect(window.localStorage.getItem("recon.language")).toBe("hu");

  unmount();
  renderApp(); // a reload keeps the choice
  expect(screen.getByRole("heading", { name: "Leltáregyeztetés" })).toBeInTheDocument();
});

test("tie cards are translated, including status words", () => {
  render(
    <I18nProvider initial="hu">
      <TieGroupCard group={tieGroup()} onSave={() => {}} onReset={() => {}} />
    </I18nProvider>,
  );
  expect(screen.getByText("3 döntésre vár")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Javaslat elfogadása" })).toBeInTheDocument();
  expect(screen.getByLabelText("Fizikai egység a(z) SN-2021-3808 SAP-tételhez")).toBeInTheDocument();
  expect(screen.getAllByText("javasolt")).toHaveLength(3);
});

test("every server value has a Hungarian label that differs from the English one", () => {
  for (const group of ["status", "issue", "errors", "messages"] as const) {
    expect(Object.keys(hu[group]).sort()).toEqual(Object.keys(en[group]).sort());
  }
  expect(hu.status["Needs decision"]).toBe("Döntésre vár");
  expect(hu.exportConfirm(3)).toContain("3 hely vár döntésre");
  expect(hu.ties.remaining(3, 17)).toBe("17 helyből 3 még döntésre vár");
});

test("server messages are rendered from their code in the chosen language", () => {
  const d = {
    kind: "Location mismatch" as const,
    code: "location_mismatch",
    params: { city: "Riverside", building: "LKS" },
    message: "Physical says Riverside, SAP says LKS.",
  };
  expect(discrepancyText(en, d)).toBe("Physical says Riverside, SAP says LKS.");
  expect(discrepancyText(hu, d)).toBe("A leltár szerint Riverside, az SAP szerint LKS.");
  const unknown = { code: "something_new", params: {}, text: "Fallback text." };
  expect(noteText(hu, unknown)).toBe("Fallback text.");
  expect(noteText(hu, { code: "tie_pick", params: { group: "g1", suggested: null }, text: "" })).toBe(
    "g1 csoport: válassza ki a fizikai egységet (javaslat: párosítatlan marad).",
  );
});
