import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../app/App";

const MATHEUS = { id: 1, name: "Matheus", role: "admin", owner: "MATHEUS" };
const RUTH = { id: 2, name: "Ruth", role: "user", owner: "RUTH" };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function mockMe(me: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (req: Request) => {
      const path = new URL(req.url).pathname.replace(/^\/api/, "");
      if (path === "/auth/me") return json(me);
      return json({ detail: "não mockado" }, 500);
    }),
  );
}

function setWidth(width: number) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => {
      const m = /min-width:\s*(\d+)px/.exec(query);
      return {
        matches: m ? width >= Number(m[1]) : false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      };
    }),
  );
}

const seen = { path: "" };
function PathSpy() {
  const { pathname } = useLocation();
  useEffect(() => {
    seen.path = pathname;
  }, [pathname]);
  return null;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <PathSpy />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("navigator", { ...navigator, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("celular (390px)", () => {
  it("barra Principal com Início, Transações, Lançar com IA, Relatórios e Mais", async () => {
    setWidth(390);
    mockMe(RUTH);
    renderAt("/");
    const nav = await screen.findByRole("navigation", { name: "Principal" });
    const names = within(nav)
      .getAllByRole("link")
      .map((a) => a.getAttribute("aria-label") ?? a.textContent?.trim());
    expect(names).toEqual(["Início", "Transações", "Lançar com IA", "Relatórios", "Mais"]);
    expect(screen.queryByRole("navigation", { name: "Menu lateral" })).toBeNull();
  });

  it("Mais lista Administração só para o admin", async () => {
    setWidth(390);
    mockMe(MATHEUS);
    renderAt("/mais");
    expect(await screen.findByRole("link", { name: /Administração/ })).toBeTruthy();
    cleanup();
    mockMe(RUTH);
    renderAt("/mais");
    expect(await screen.findByRole("link", { name: /Metas/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Administração/ })).toBeNull();
  });
});

describe("computador (1280px)", () => {
  it("menu lateral sem Administração para a Ruth", async () => {
    setWidth(1280);
    mockMe(RUTH);
    renderAt("/");
    const nav = await screen.findByRole("navigation", { name: "Menu lateral" });
    for (const name of ["Dashboard", "Transações", "Contas fixas", "Contas", "Metas", "Plano", "Relatórios", "Lançar com IA"]) {
      expect(within(nav).getByRole("link", { name })).toBeTruthy();
    }
    expect(within(nav).queryByText("Administração")).toBeNull();
    expect(within(nav).queryByRole("link", { name: "Usuários" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Principal" })).toBeNull();
  });

  it("menu lateral com as seis seções de Administração para o Matheus", async () => {
    setWidth(1280);
    mockMe(MATHEUS);
    renderAt("/");
    const nav = await screen.findByRole("navigation", { name: "Menu lateral" });
    for (const name of ["Usuários", "Configurações", "Avisos do sistema", "IA", "Auditoria", "Sistema"]) {
      expect(within(nav).getByRole("link", { name })).toBeTruthy();
    }
  });
});

describe("rotas", () => {
  it("/geral redireciona para /", async () => {
    setWidth(390);
    mockMe(RUTH);
    renderAt("/geral");
    await screen.findByRole("navigation", { name: "Principal" });
    await waitFor(() => expect(seen.path).toBe("/"));
  });

  it("/mais/admin redireciona para /admin/usuarios (admin)", async () => {
    setWidth(390);
    mockMe(MATHEUS);
    renderAt("/mais/admin");
    expect(await screen.findByRole("heading", { name: "Usuários", level: 1 })).toBeTruthy();
    await waitFor(() => expect(seen.path).toBe("/admin/usuarios"));
  });

  it("/admin/ia como Ruth volta para /", async () => {
    setWidth(390);
    mockMe(RUTH);
    renderAt("/admin/ia");
    await screen.findByRole("navigation", { name: "Principal" });
    await waitFor(() => expect(seen.path).toBe("/"));
  });

  it("/lancar abre o chat", async () => {
    setWidth(390);
    mockMe(RUTH);
    renderAt("/lancar");
    expect(await screen.findByRole("region", { name: "Chat de lançamentos" })).toBeTruthy();
  });
});
