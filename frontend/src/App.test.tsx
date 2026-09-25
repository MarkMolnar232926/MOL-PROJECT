import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import App from "./App";
import { en } from "./i18n/en";

afterEach(() => vi.restoreAllMocks());

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

test("shows API connected when /api/health answers", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
  );
  renderApp();
  expect(await screen.findByText(en.apiOk)).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith("/api/health");
});

test("shows API not reachable on error", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 502 }));
  renderApp();
  expect(await screen.findByText(en.apiDown)).toBeInTheDocument();
});
