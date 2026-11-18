import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../AuthProvider";
import { LoginPage } from "../LoginPage";

const RUTH = { id: 2, name: "Ruth", role: "member", owner: "RUTH" };
const GENERIC = "Não foi possível entrar. Confira o nome e o PIN.";
const TOO_MANY = "Muitas tentativas. Aguarde alguns minutos e tente de novo.";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let loginStatus = 200;
let loginBodies: { name: string; pin: string; device_label: string }[] = [];
let paths: string[] = [];

beforeEach(() => {
  loginStatus = 200;
  loginBodies = [];
  paths = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (req: Request) => {
      const path = new URL(req.url).pathname.replace(/^\/api/, "");
      paths.push(path);
      if (path === "/auth/me") return json({ detail: "sem sessão" }, 401);
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

const nameField = () => screen.getByLabelText("Seu nome") as HTMLInputElement;
const typeName = (name: string) => fireEvent.change(nameField(), { target: { value: name } });
const tap = (digits: string) => {
  for (const d of digits) fireEvent.click(screen.getByRole("button", { name: d }));
};

describe("LoginPage", () => {
  it("mostra a marca, o campo de nome e o teclado, sem lista de usuários", () => {
    renderLogin();
    expect(screen.getByRole("heading", { name: "Finanças", level: 1 })).toBeTruthy();
    const field = nameField();
    expect(field.getAttribute("autocomplete")).toBe("username");
    expect(field.getAttribute("autocapitalize")).toBe("words");
    expect(screen.getByRole("img", { name: "0 de 6 dígitos" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ruth" })).toBeNull();
    expect(screen.queryByText("Quem está entrando?")).toBeNull();
    expect(paths).not.toContain("/auth/users");
  });

  it("teclado redondo: dígitos 0–9 e apagar, cada um com seu nome", () => {
    renderLogin();
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

  it("anuncia o progresso do PIN numa região de status, sem revelar os dígitos", () => {
    renderLogin();
    expect(screen.getByRole("status").textContent).toBe("Nenhum dígito digitado");
    tap("12");
    expect(screen.getByRole("status").textContent).toBe("2 de 6 dígitos digitados");
  });

  it("nome + 6 dígitos envia name, pin e device_label e entra", async () => {
    renderLogin();
    typeName("  Ruth ");
    tap("123456");
    expect(await screen.findByText("Tela inicial")).toBeTruthy();
    expect(loginBodies).toEqual([{ name: "Ruth", pin: "123456", device_label: expect.any(String) }]);
    expect(paths).not.toContain("/auth/users");
  });

  it("401 mostra a mensagem genérica e limpa o PIN", async () => {
    loginStatus = 401;
    renderLogin();
    typeName("Ruth");
    tap("111111");
    expect((await screen.findByRole("alert")).textContent).toBe(GENERIC);
    expect(await screen.findByRole("img", { name: "0 de 6 dígitos" })).toBeTruthy();
    expect(nameField().value).toBe("Ruth");
  });

  it("429 pede para aguardar", async () => {
    loginStatus = 429;
    renderLogin();
    typeName("Matheus");
    tap("222222");
    expect((await screen.findByRole("alert")).textContent).toBe(TOO_MANY);
  });

  it("PIN completo sem nome não envia e foca o campo de nome", () => {
    renderLogin();
    typeName("   ");
    tap("123456");
    expect(loginBodies).toEqual([]);
    expect(paths).not.toContain("/auth/login");
    expect(document.activeElement).toBe(nameField());
    expect(screen.getByRole("alert").textContent).toBe("Digite seu nome antes do PIN.");
    expect(screen.getByRole("img", { name: "0 de 6 dígitos" })).toBeTruthy();
  });
});
