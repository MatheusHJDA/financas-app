import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./app/App";

const ME = { id: 1, name: "Matheus", role: "admin", owner: "MATHEUS" };
const USERS = [
  { id: 1, name: "Matheus" },
  { id: 2, name: "Ruth" },
];

type Handler = (req: Request) => Response | Promise<Response>;
type Routes = Record<string, Handler>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let calls: { key: string; req: Request }[] = [];

function mockApi(routes: Routes) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (req: Request) => {
      const key = `${req.method} ${new URL(req.url).pathname.replace(/^\/api/, "")}`;
      calls.push({ key, req });
      const handler = routes[key];
      return handler ? handler(req) : json({ detail: "não mockado" }, 500);
    }),
  );
}

function renderApp(path = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function typePin(pin: string) {
  for (const d of pin) fireEvent.click(await screen.findByRole("button", { name: d }));
}

async function chooseUser(name: string) {
  fireEvent.click(await screen.findByRole("button", { name }));
}

beforeEach(() => {
  vi.stubGlobal("navigator", { ...navigator, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("sem sessão leva ao login e lista os usuários", async () => {
  mockApi({
    "GET /auth/me": () => json({ detail: "x" }, 401),
    "GET /auth/users": () => json(USERS),
  });
  renderApp("/geral");
  expect(await screen.findByText("Quem está entrando?")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Ruth" })).toBeTruthy();
});

it("login com sucesso envia user_id, pin e device_label e abre o app", async () => {
  mockApi({
    "GET /auth/me": () => json({ detail: "x" }, 401),
    "GET /auth/users": () => json(USERS),
    "POST /auth/login": () => json(ME),
  });
  renderApp();
  await chooseUser("Matheus");
  await typePin("123456");
  expect(await screen.findByRole("navigation", { name: "Principal" })).toBeTruthy();
  const login = calls.find((c) => c.key === "POST /auth/login")!;
  expect(await login.req.json()).toEqual({ user_id: 1, pin: "123456", device_label: "iPhone" });
  expect(login.req.credentials).toBe("include");
});

it("PIN errado mostra erro legível e limpa os dígitos", async () => {
  mockApi({
    "GET /auth/me": () => json({ detail: "x" }, 401),
    "GET /auth/users": () => json(USERS),
    "POST /auth/login": () => json({ detail: "PIN inválido" }, 401),
  });
  renderApp();
  await chooseUser("Ruth");
  await typePin("000000");
  expect((await screen.findByRole("alert")).textContent).toContain("PIN incorreto");
  expect(screen.getByRole("img", { name: "0 de 6 dígitos" })).toBeTruthy();
});

it("conta bloqueada (423) explica o bloqueio", async () => {
  mockApi({
    "GET /auth/me": () => json({ detail: "x" }, 401),
    "GET /auth/users": () => json(USERS),
    "POST /auth/login": () => json({ detail: "bloqueado" }, 423),
  });
  renderApp();
  await chooseUser("Ruth");
  await typePin("111111");
  expect((await screen.findByRole("alert")).textContent).toContain("bloqueado");
});

it("um 401 durante o uso redireciona para o login", async () => {
  let meCalls = 0;
  mockApi({
    "GET /auth/me": () => {
      meCalls += 1;
      return json(ME);
    },
    "POST /auth/logout": () => json({ detail: "x" }, 401),
    "GET /auth/users": () => json(USERS),
  });
  renderApp("/mais");
  fireEvent.click(await screen.findByRole("button", { name: "Sair" }));
  expect(await screen.findByText("Quem está entrando?")).toBeTruthy();
  expect(meCalls).toBe(1);
});

it("navega entre as 5 abas e Mais traz instalação e Sair", async () => {
  mockApi({ "GET /auth/me": () => json(ME) });
  renderApp();
  const nav = await screen.findByRole("navigation", { name: "Principal" });
  expect(nav.querySelectorAll("a")).toHaveLength(5);
  expect(await screen.findByRole("heading", { name: "Chat" })).toBeTruthy();
  for (const tab of ["Geral", "Metas", "Plano"]) {
    fireEvent.click(screen.getByRole("link", { name: new RegExp(tab) }));
    expect(await screen.findByRole("heading", { name: tab })).toBeTruthy();
  }
  fireEvent.click(screen.getByRole("link", { name: /Mais/ }));
  expect(await screen.findByRole("heading", { name: "Como instalar no celular" })).toBeTruthy();
  expect(screen.getByText(/Adicionar à Tela de Início/)).toBeTruthy();
  expect(screen.getByText(/Instalar app/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Sair" })).toBeTruthy();
});

it("Sair encerra a sessão e volta ao login", async () => {
  mockApi({
    "GET /auth/me": () => json(ME),
    "POST /auth/logout": () => new Response(null, { status: 204 }),
    "GET /auth/users": () => json(USERS),
  });
  renderApp("/mais");
  fireEvent.click(await screen.findByRole("button", { name: "Sair" }));
  await waitFor(() => expect(calls.some((c) => c.key === "POST /auth/logout")).toBe(true));
  expect(await screen.findByText("Quem está entrando?")).toBeTruthy();
});
