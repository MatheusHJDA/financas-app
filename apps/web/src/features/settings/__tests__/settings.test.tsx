import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../../auth/AuthProvider";
import { MORE_ITEMS } from "../../../shell/nav";
import MorePage from "../MorePage";
import PreferencesPage from "../PreferencesPage";
import { THEME_KEY } from "../theme";

const MATHEUS = { id: 1, name: "Matheus", role: "admin", owner: "MATHEUS" };
const RUTH = { id: 2, name: "Ruth", role: "user", owner: "RUTH" };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let calls: string[] = [];
let meDelay = 0;

function mockApi(me: unknown) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (req: Request) => {
      const path = new URL(req.url).pathname.replace(/^\/api/, "");
      calls.push(`${req.method} ${path}`);
      if (path === "/auth/me") {
        if (meDelay) await new Promise((r) => setTimeout(r, meDelay));
        return json(me);
      }
      if (path === "/auth/logout") return new Response(null, { status: 204 });
      return json({ detail: "não mockado" }, 500);
    }),
  );
}

function renderPage(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  vi.stubGlobal("navigator", { ...navigator, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" });
  meDelay = 0;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MorePage", () => {
  it("lista os itens de MORE_ITEMS com ícone, 'Conectado como' e Sair (Ruth sem Administração)", async () => {
    mockApi(RUTH);
    renderPage(<MorePage />);
    expect(await screen.findByText("Conectado como Ruth")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Mais", level: 1 })).toBeTruthy();
    const expected = MORE_ITEMS.filter((i) => !i.adminOnly);
    for (const item of expected) {
      const link = screen.getByRole("link", { name: item.label });
      expect(link.getAttribute("href")).toBe(item.to);
      expect(link.querySelector("svg")).not.toBeNull();
    }
    expect(screen.getAllByRole("link")).toHaveLength(expected.length);
    expect(screen.queryByRole("link", { name: /Administração/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Sair" })).toBeTruthy();
  });

  it("Matheus vê Administração", async () => {
    mockApi(MATHEUS);
    renderPage(<MorePage />);
    const link = await screen.findByRole("link", { name: "Administração" });
    expect(link.getAttribute("href")).toBe("/admin/usuarios");
  });

  it("mostra skeleton enquanto carrega o usuário", async () => {
    meDelay = 30;
    mockApi(RUTH);
    renderPage(<MorePage />);
    expect(screen.getByRole("status", { name: "Carregando" })).toBeTruthy();
    expect(await screen.findByText("Conectado como Ruth")).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Carregando" })).toBeNull();
  });

  it("Sair chama o logout", async () => {
    mockApi(RUTH);
    renderPage(<MorePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Sair" }));
    await waitFor(() => expect(calls).toContain("POST /auth/logout"));
  });
});

describe("PreferencesPage", () => {
  function renderPrefs() {
    mockApi(RUTH);
    renderPage(<PreferencesPage />);
  }

  it("tem notificações, instruções de instalar e o tema", () => {
    renderPrefs();
    expect(screen.getByRole("heading", { name: "Preferências", level: 1 })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Notificações" })).toBeTruthy();
    const install = screen.getByRole("region", { name: "Como instalar no celular" });
    expect(within(install).getByText(/Safari → Compartilhar/)).toBeTruthy();
    expect(within(install).getByText(/Chrome → menu/)).toBeTruthy();
    const group = screen.getByRole("radiogroup", { name: "Tema" });
    expect(within(group).getAllByRole("radio")).toHaveLength(3);
    for (const name of ["Claro", "Escuro", "Automático"]) {
      expect(within(group).getByRole("radio", { name })).toBeTruthy();
    }
  });

  it("diz em texto qual é o aparelho atual nas instruções (não só destaque visual)", () => {
    vi.stubGlobal("navigator", { ...navigator, userAgent: "Mozilla/5.0 (Linux; Android 13)" });
    try {
      renderPrefs();
      const install = screen.getByRole("region", { name: "Como instalar no celular" });
      expect(within(install).getByRole("heading", { name: "Android (este aparelho)" })).toBeTruthy();
      expect(within(install).getByRole("heading", { name: "iPhone" })).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("começa em Automático e não marca data-theme", () => {
    renderPrefs();
    expect((screen.getByRole("radio", { name: "Automático" }) as HTMLInputElement).checked).toBe(true);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("Escuro grava data-theme e lembra no aparelho; Claro idem; Automático remove", () => {
    renderPrefs();
    fireEvent.click(screen.getByRole("radio", { name: "Escuro" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    fireEvent.click(screen.getByRole("radio", { name: "Claro" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
    fireEvent.click(screen.getByRole("radio", { name: "Automático" }));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem(THEME_KEY)).toBe("auto");
  });

  it("abre com a escolha lembrada", () => {
    localStorage.setItem(THEME_KEY, "dark");
    renderPrefs();
    expect((screen.getByRole("radio", { name: "Escuro" }) as HTMLInputElement).checked).toBe(true);
  });

  it("troca de tema mesmo se o localStorage lançar", () => {
    renderPrefs();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    fireEvent.click(screen.getByRole("radio", { name: "Escuro" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
