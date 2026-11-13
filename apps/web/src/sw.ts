/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

// Push (U7): o servidor manda JSON {title, body, url}.
interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
}

function readPayload(data: PushMessageData | null): PushPayload {
  if (!data) return {};
  try {
    return (data.json() as PushPayload | null) ?? {};
  } catch {
    return { body: data.text() };
  }
}

self.addEventListener("push", (event) => {
  const payload = readPayload(event.data);
  event.waitUntil(
    self.registration.showNotification(payload.title || "Finanças", {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let target = new URL((event.notification.data?.url as string | undefined) || "/", self.location.origin);
  // só navega dentro do próprio app (nunca para outra origem vinda do payload)
  if (target.origin !== self.location.origin) target = new URL("/", self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === target.origin);
      if (open) {
        const focused = await open.focus();
        // navigate() existe só em janelas controladas; se falhar, abre uma nova.
        try {
          await (focused ?? open).navigate(target.href);
          return;
        } catch {
          /* cai para openWindow */
        }
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
