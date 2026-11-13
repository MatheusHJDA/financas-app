import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NotificationsCard } from "./NotificationsCard";

const ANDROID = "Mozilla/5.0 (Linux; Android 13)";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
// "AQID" em base64url = bytes 1, 2, 3.
const VAPID = "AQID";
const ENDPOINT = "https://push.example.test/abc";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Handler = (req: Request) => Response | Promise<Response>;
let calls: { key: string; req: Request }[] = [];

function mockFetch(routes: Record<string, Handler>) {
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

const SERVER_SUB = {
  id: 7,
  user_id: 1,
  endpoint: ENDPOINT,
  device_label: "Android",
  created_at: "2026-11-13T12:00:00Z",
  last_ok_at: null,
};

interface PushEnv {
  userAgent?: string;
  standalone?: boolean;
  permission?: NotificationPermission;
  requestResult?: NotificationPermission;
  existing?: boolean; // este aparelho já tem inscrição
  pushManager?: boolean;
}

/** Simula serviceWorker, PushManager e Notification do navegador. */
function setupBrowser(env: PushEnv = {}) {
  const subscription = {
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: "chave-p256dh", auth: "chave-auth" } }),
    unsubscribe: vi.fn(async () => true),
  };
  let current: typeof subscription | null = env.existing ? subscription : null;
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async () => {
      current = subscription;
      return subscription;
    }),
  };
  vi.stubGlobal("navigator", {
    userAgent: env.userAgent ?? ANDROID,
    standalone: env.standalone,
    serviceWorker: { ready: Promise.resolve({ pushManager }) },
  });
  if (env.pushManager !== false) vi.stubGlobal("PushManager", class {});
  const requestPermission = vi.fn(async () => env.requestResult ?? "granted");
  vi.stubGlobal("Notification", { permission: env.permission ?? "default", requestPermission });
  return { pushManager, subscription, requestPermission };
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NotificationsCard />
    </QueryClientProvider>,
  );
}

const writes = () => calls.filter((c) => c.req.method !== "GET").map((c) => c.key);

beforeEach(() => {
  mockFetch({
    "GET /push/vapid-public-key": () => json({ public_key: VAPID }),
    "GET /push/subscriptions": () => json([]),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("só age no toque: nada de permissão nem inscrição ao abrir", async () => {
  const env = setupBrowser();
  renderCard();
  await screen.findByRole("button", { name: "Ativar notificações" });
  expect(env.requestPermission).not.toHaveBeenCalled();
  expect(env.pushManager.subscribe).not.toHaveBeenCalled();
  expect(writes()).toEqual([]);
});

it("ativar: pede permissão, inscreve com a chave da API e registra o aparelho", async () => {
  const env = setupBrowser();
  let subscribed = false;
  mockFetch({
    "GET /push/vapid-public-key": () => json({ public_key: VAPID }),
    "GET /push/subscriptions": () => json(subscribed ? [SERVER_SUB] : []),
    "POST /push/subscriptions": (req) => {
      subscribed = true;
      return req.clone().json().then((b) => json({ ...SERVER_SUB, device_label: b.device_label }, 201));
    },
  });
  renderCard();
  fireEvent.click(await screen.findByRole("button", { name: "Ativar notificações" }));

  expect(await screen.findByText("Ativadas neste aparelho")).toBeTruthy();
  expect(env.requestPermission).toHaveBeenCalledTimes(1);
  const options = (env.pushManager.subscribe.mock.calls as unknown[][])[0][0] as {
    userVisibleOnly: boolean;
    applicationServerKey: Uint8Array;
  };
  expect(options.userVisibleOnly).toBe(true);
  expect(Array.from(options.applicationServerKey)).toEqual([1, 2, 3]);
  const post = calls.find((c) => c.key === "POST /push/subscriptions")!;
  expect(await post.req.clone().json()).toEqual({
    endpoint: ENDPOINT,
    keys: { p256dh: "chave-p256dh", auth: "chave-auth" },
    device_label: "Android",
  });
  expect(screen.getByRole("button", { name: "Desativar" })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("ativadas");
});

it("desativar: cancela a inscrição no aparelho e apaga no servidor", async () => {
  const env = setupBrowser({ existing: true, permission: "granted" });
  let removed = false;
  mockFetch({
    "GET /push/vapid-public-key": () => json({ public_key: VAPID }),
    "GET /push/subscriptions": () => json(removed ? [] : [SERVER_SUB]),
    "DELETE /push/subscriptions/7": () => {
      removed = true;
      return new Response(null, { status: 204 });
    },
  });
  renderCard();
  expect(await screen.findByText("Ativadas neste aparelho")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Desativar" }));

  await waitFor(() => expect(env.subscription.unsubscribe).toHaveBeenCalledTimes(1));
  expect(writes()).toEqual(["DELETE /push/subscriptions/7"]);
});

it("aparelho inscrito mas ausente no servidor volta a oferecer o botão", async () => {
  setupBrowser({ existing: true, permission: "granted" });
  renderCard();
  expect(await screen.findByRole("button", { name: "Ativar notificações" })).toBeTruthy();
});

it("sem suporte (sem serviceWorker/PushManager): explica e não mostra botão", async () => {
  setupBrowser({ pushManager: false }); // o jsdom não tem PushManager
  renderCard();
  expect(await screen.findByText(/não permite notificações/)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
  expect(calls).toEqual([]);
});

it("iPhone fora do modo instalado: pede para instalar o app na tela de início", async () => {
  setupBrowser({ userAgent: IPHONE, standalone: false, pushManager: false });
  renderCard();
  expect(await screen.findByText("Instale o app na tela de início para receber notificações")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

it("iPhone instalado (standalone) mostra o botão", async () => {
  setupBrowser({ userAgent: IPHONE, standalone: true });
  renderCard();
  expect(await screen.findByRole("button", { name: "Ativar notificações" })).toBeTruthy();
});

it("permissão negada ao pedir: explica como liberar nas configurações", async () => {
  setupBrowser({ requestResult: "denied" });
  renderCard();
  fireEvent.click(await screen.findByRole("button", { name: "Ativar notificações" }));
  expect(await screen.findByText(/configurações do aparelho/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Ativar notificações" })).toBeNull();
  expect(writes()).toEqual([]);
});

it("permissão já bloqueada: mostra a explicação sem botão", async () => {
  const env = setupBrowser({ permission: "denied" });
  renderCard();
  expect(await screen.findByText(/configurações do aparelho/)).toBeTruthy();
  expect(env.requestPermission).not.toHaveBeenCalled();
});

it("servidor sem chaves VAPID: avisa que não está configurado", async () => {
  setupBrowser();
  mockFetch({
    "GET /push/vapid-public-key": () => json({ public_key: "" }),
    "GET /push/subscriptions": () => json([]),
  });
  renderCard();
  expect(await screen.findByText("Notificações não configuradas no servidor.")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

it("falha ao registrar no servidor: desfaz a inscrição local e avisa", async () => {
  const env = setupBrowser();
  mockFetch({
    "GET /push/vapid-public-key": () => json({ public_key: VAPID }),
    "GET /push/subscriptions": () => json([]),
    "POST /push/subscriptions": () => json({ detail: "erro" }, 500),
  });
  renderCard();
  fireEvent.click(await screen.findByRole("button", { name: "Ativar notificações" }));
  expect(await screen.findByText(/Não foi possível ativar/)).toBeTruthy();
  expect(env.subscription.unsubscribe).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Ativar notificações" })).toBeTruthy();
});
