import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("mostra o título e o status ok da API", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: "ok", version: "0.1.0" }), { status: 200 })),
  );
  renderApp();
  expect(screen.getByRole("heading", { name: "Finanças" })).toBeTruthy();
  expect(await screen.findByText("ok")).toBeTruthy();
});

it("mostra erro quando a API falha", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x", { status: 500 })));
  renderApp();
  expect(await screen.findByText("erro")).toBeTruthy();
});
