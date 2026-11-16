import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../AuthProvider";
import { LoginPage } from "../LoginPage";

const USERS = [
  { id: 1, name: "Matheus" },
  { id: 2, name: "Ruth" },
];
const RUTH = { id: 2, name: "Ruth", role: "user", owner: "RUTH" };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let loginStatus = 200;
let loginBodies: { user_id: number; pin: string }[] = [];
let usersDelay = 0;

beforeEach(() => {
  loginStatus = 200;
  loginBodies = [];
  usersDelay = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (req: Request) => {
      const path = new URL(req.url).pathname.replace(/^\/api/, "");
      if (path === "/auth/me") return json({ detail: "sem sessão" }, 401);
      if (path === "/auth/users") {
        if (usersDelay) await new Promise((r) => setTimeout(r, usersDelay));
        return json(USERS);
      }
      if (path === "/auth/login") {
        loginBodies.push(await req.json());
        return loginStatus === 200 ? json(RUTH) : json({ detail: "x" }, loginStatus);
      }
      return json({ detail: "não mockado" }, 500);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderLogin() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={["/login"]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<p>Tela inicial</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

async function pickUser(name: string) {
  fireEvent.click(await screen.findByRole("button", { name }));
}
const tap = (digits: string) => {
  for (const d of digits) fireEvent.click(screen.getByRole("button", { name: d }));
};

describe("LoginPage", () => {
  it("mostra skeleton enquanto carrega os usuários", async () => {
    usersDelay = 30;
    renderLogin();
    expect(screen.getByRole("status", { name: "Carregando usuários" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Quem está entrando?" })).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Carregando usuários" })).toBeNull();
  });

  it("lista os usuários como botões com o nome exato", async () => {
    renderLogin();
    expect(await screen.findByRole("heading", { name: "Quem está entrando?" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Finanças", level: 1 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Matheus" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ruth" })).toBeTruthy();
  });

  it("teclado redondo: dígitos 0–9 e apagar, cada um com seu nome", async () => {
    renderLogin();
    await pickUser("Ruth");
    expect(screen.getByRole("heading", { name: "Olá, Ruth. Digite seu PIN" })).toBeTruthy();
    for (const d of "0123456789") {
      const key = screen.getByRole("button", { name: d });
      expect(key.classList.contains("login-key")).toBe(true);
    }
    const del = screen.getByRole("button", { name: "Apagar último dígito" });
    expect((del as HTMLButtonElement).disabled).toBe(true);
    tap("12");
    expect(screen.getByRole("img", { name: "2 de 6 dígitos" })).toBeTruthy();
    fireEvent.click(del);
    expect(screen.getByRole("img", { name: "1 de 6 dígitos" })).toBeTruthy();
  });

  it("anuncia o progresso do PIN numa região de status, sem revelar os dígitos", async () => {
    renderLogin();
    await pickUser("Ruth");
    expect(screen.getByRole("status").textContent).toBe("Nenhum dígito digitado");
    tap("12");
    expect(screen.getByRole("status").textContent).toBe("2 de 6 dígitos digitados");
  });

  it("PIN incorreto mostra o erro e zera os pontos", async () => {
    loginStatus = 401;
    renderLogin();
    await pickUser("Ruth");
    tap("111111");
    expect(await screen.findByText(/PIN incorreto/)).toBeTruthy();
    expect(screen.getByRole("img", { name: "0 de 6 dígitos" })).toBeTruthy();
    expect(loginBodies).toEqual([expect.objectContaining({ user_id: 2, pin: "111111" })]);
  });

  it("bloqueio (423) explica a espera", async () => {
    loginStatus = 423;
    renderLogin();
    await pickUser("Matheus");
    tap("222222");
    expect(await screen.findByText(/Acesso bloqueado/)).toBeTruthy();
  });

  it("PIN certo entra e vai para o início", async () => {
    renderLogin();
    await pickUser("Ruth");
    tap("123456");
    expect(await screen.findByText("Tela inicial")).toBeTruthy();
  });

  it("Não sou X volta à escolha de usuário", async () => {
    renderLogin();
    await pickUser("Ruth");
    fireEvent.click(screen.getByRole("button", { name: "Não sou Ruth" }));
    const who = await screen.findByRole("heading", { name: "Quem está entrando?" });
    await waitFor(() => expect(within(who.closest("section")!).getAllByRole("button")).toHaveLength(2));
  });
});
