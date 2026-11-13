// Apoio do cartão de notificações: detecção de suporte e conversões do Web Push.

export type PushSupport = "ok" | "install" | "unsupported";

const READY_TIMEOUT_MS = 8000;

/** App aberto como PWA instalado (tela de início). No iPhone, só assim existe push. */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  return typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches;
}

export function pushSupport(platform: "iphone" | "android" | "other"): PushSupport {
  // iPhone no Safari comum não expõe PushManager: o motivo certo é "instalar", não "sem suporte".
  if (platform === "iphone" && !isStandalone()) return "install";
  const ok = "serviceWorker" in navigator && "PushManager" in globalThis && "Notification" in globalThis;
  return ok ? "ok" : "unsupported";
}

/** Chave pública VAPID (base64url) → bytes, como o pushManager.subscribe exige. */
export function urlBase64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Registro do service worker; não trava para sempre se ele não estiver instalado (ex.: dev). */
export async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("service-worker-indisponivel")), READY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
