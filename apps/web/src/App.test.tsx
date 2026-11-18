import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./app/App";

const ME = { id: 1, name: "Matheus", role: "admin", owner: "MATHEUS" };

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

async function typeName(name: string) {
  fireEvent.change(await screen.findByLabelText("Seu nome"), { target: { value: name } });
}

beforeEach(() => {
  vi.stubGlobal("navigator", { ...navigator, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("sem sessão leva ao login, que pede o nome (sem lista de usuários)", async () => {
  mockApi({
    "GET /auth/me": () => json({ detail: "x" }, 401),
  });
  renderApp("/geral");
  expect(await screen.findByLabelText("Seu nome")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Ruth" })).toBeNull();
  expect(calls.some((c) => c.key === "GET /auth/users")).toBe(false);
});

it("login com sucesso envia name, pin e device_label e abre o app", async () => {
  mockApi({
    "GET /auth/me": () => json({ detail: "x" }, 401),
    "POST /auth/login": () => json(ME),
  });
  renderApp();
  await typeName("Matheus");
  await typePin("123456");
  expect(await screen.findByRole("navigation", { name: "Principal" })).toBeTruthy();
  const login = calls.find((c) => c.key === "POST /auth/login")!;
  expect(await login.req.json()).toEqual({ name: "Matheus", pin: "123456", device_label: "iPhone" });
  expect(login.req.credentials).toBe("include");
});

it("PIN errado mostra erro legível e limpa os dígitos", async () => {
  mockApi({
    "GET /auth/me": () => json({ detail: "x" }, 401),
    "POST /auth/login": () => json({ detail: "x" }, 401),
  });
  renderApp();
  await typeName("Ruth");
  await typePin("000000");
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Não foi possível entrar. Confira o nome e o PIN.",
  );
  expect(screen.getByRole("img", { name: "0 de 6 dígitos" })).toBeTruthy();
});

it("muitas tentativas (429) pede para aguardar", async () => {
  mockApi({
    "GET /auth/me": () => json({ detail: "x" }, 401),
    "POST /auth/login": () => json({ detail: "x" }, 429),
  });
  renderApp();
  await typeName("Ruth");
  await typePin("111111");
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Muitas tentativas. Aguarde alguns minutos e tente de novo.",
  );
});

it("um 401 durante o uso redireciona para o login", async () => {
  let meCalls = 0;
  mockApi({
    "GET /auth/me": () => {
      meCalls += 1;
      return json(ME);
    },
    "POST /auth/logout": () => json({ detail: "x" }, 401),
  });
  renderApp("/mais");
  fireEvent.click(await screen.findByRole("button", { name: "Sair" }));
  expect(await screen.findByLabelText("Seu nome")).toBeTruthy();
  expect(meCalls).toBe(1);
});

it("navega pela barra, Mais leva a Preferências e tem Sair", async () => {
  mockApi({ "GET /auth/me": () => json(ME) });
  renderApp();
  const nav = await screen.findByRole("navigation", { name: "Principal" });
  expect(nav.querySelectorAll("a")).toHaveLength(5);
  expect(await screen.findByRole("heading", { name: "Início" })).toBeTruthy();
  for (const [link, heading] of [
    ["Transações", "Transações"],
    ["Relatórios", "Relatórios"],
  ]) {
    fireEvent.click(screen.getByRole("link", { name: new RegExp(link) }));
    expect(await screen.findByRole("heading", { name: heading, level: 1 })).toBeTruthy();
  }
  fireEvent.click(screen.getByRole("link", { name: "Lançar com IA" }));
  expect(await screen.findByRole("region", { name: "Chat de lançamentos" })).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: /Mais/ }));
  expect(await screen.findByRole("button", { name: "Sair" })).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: /Preferências/ }));
  expect(await screen.findByRole("heading", { name: "Como instalar no celular" })).toBeTruthy();
  expect(screen.getByText(/Adicionar à Tela de Início/)).toBeTruthy();
  expect(screen.getByText(/Instalar app/)).toBeTruthy();
});

it("Sair encerra a sessão e volta ao login", async () => {
  mockApi({
    "GET /auth/me": () => json(ME),
    "POST /auth/logout": () => new Response(null, { status: 204 }),
  });
  renderApp("/mais");
  fireEvent.click(await screen.findByRole("button", { name: "Sair" }));
  await waitFor(() => expect(calls.some((c) => c.key === "POST /auth/logout")).toBe(true));
  expect(await screen.findByLabelText("Seu nome")).toBeTruthy();
});
