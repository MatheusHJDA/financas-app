// Dono: U7. Cartão "Notificações" da aba Mais (botão "Ativar notificações", aparelhos).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { deviceLabel, detectPlatform } from "../../auth/deviceLabel";
import { pushSupport, readyRegistration, urlBase64ToBytes } from "./push";

const SUBSCRIPTIONS_KEY = ["push-subscriptions"] as const;
const VAPID_KEY = ["push", "vapid-public-key"] as const;
const LOCAL_KEY = ["push", "local-endpoint"] as const;

const DENIED_HELP =
  "As notificações estão bloqueadas neste aparelho. Para liberar, abra as configurações do aparelho, " +
  "procure o app Finanças em Notificações, permita os avisos e volte aqui.";

async function loadVapidKey(): Promise<string> {
  const { data, response } = await api.GET("/push/vapid-public-key");
  if (!data) throw new Error(`HTTP ${response.status}`);
  return data.public_key;
}

async function loadSubscriptions() {
  const { data, response } = await api.GET("/push/subscriptions");
  if (!data) throw new Error(`HTTP ${response.status}`);
  return data;
}

async function loadLocalEndpoint(): Promise<string | null> {
  try {
    const registration = await readyRegistration();
    return (await registration.pushManager.getSubscription())?.endpoint ?? null;
  } catch {
    return null;
  }
}

function permissionDenied(): boolean {
  return "Notification" in globalThis && Notification.permission === "denied";
}

export function NotificationsCard() {
  const platform = detectPlatform();
  const support = pushSupport(platform);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [denied, setDenied] = useState(permissionDenied);

  // A pessoa libera nas configurações do aparelho e volta: relê a permissão.
  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState === "visible") setDenied(permissionDenied());
    };
    globalThis.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      globalThis.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, []);

  const usable = support === "ok";
  const vapid = useQuery({ queryKey: VAPID_KEY, queryFn: loadVapidKey, enabled: usable, staleTime: Infinity });
  const subs = useQuery({ queryKey: SUBSCRIPTIONS_KEY, queryFn: loadSubscriptions, enabled: usable });
  const local = useQuery({ queryKey: LOCAL_KEY, queryFn: loadLocalEndpoint, enabled: usable, staleTime: 0 });

  const mine = local.data ? subs.data?.find((s) => s.endpoint === local.data) : undefined;
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY }),
      queryClient.invalidateQueries({ queryKey: LOCAL_KEY }),
    ]);

  async function enable() {
    const publicKey = vapid.data;
    if (!publicKey) return;
    setBusy(true);
    setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setDenied(permission === "denied");
        setMessage(permission === "denied" ? "" : "Permissão não concedida. Toque em Ativar notificações para tentar de novo.");
        return;
      }
      const registration = await readyRegistration();
      const existing = await registration.pushManager.getSubscription();
      const created =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToBytes(publicKey),
        }));
      const json = created.toJSON();
      const keys = json.keys;
      if (!json.endpoint || !keys?.p256dh || !keys.auth) throw new Error("inscrição incompleta");
      const { response } = await api.POST("/push/subscriptions", {
        body: { endpoint: json.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, device_label: deviceLabel() },
      });
      if (!response.ok) {
        if (!existing) await created.unsubscribe().catch(() => undefined);
        throw new Error(`HTTP ${response.status}`);
      }
      setMessage("Notificações ativadas neste aparelho.");
    } catch {
      setMessage("Não foi possível ativar as notificações. Tente de novo.");
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage("");
    try {
      const registration = await readyRegistration();
      const current = await registration.pushManager.getSubscription();
      if (mine) {
        const { response } = await api.DELETE("/push/subscriptions/{id}", { params: { path: { id: mine.id } } });
        if (!response.ok && response.status !== 404) throw new Error(`HTTP ${response.status}`);
      }
      await current?.unsubscribe();
      setMessage("Notificações desativadas neste aparelho.");
    } catch {
      setMessage("Não foi possível desativar as notificações. Tente de novo.");
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  let body;
  if (support === "install") {
    body = <p>Instale o app na tela de início para receber notificações</p>;
  } else if (support === "unsupported") {
    body = <p>Este navegador não permite notificações. Use o app instalado no celular (Chrome no Android ou Safari no iPhone).</p>;
  } else if (vapid.isError || subs.isError) {
    body = <p role="alert">Não foi possível carregar as notificações. Tente de novo mais tarde.</p>;
  } else if (vapid.isPending || subs.isPending || local.isPending) {
    body = <p className="muted">Verificando…</p>;
  } else if (vapid.data === "") {
    body = <p>Notificações não configuradas no servidor.</p>;
  } else if (mine) {
    body = (
      <>
        <p>Ativadas neste aparelho</p>
        <button type="button" className="btn" disabled={busy} onClick={() => void disable()}>
          Desativar
        </button>
      </>
    );
  } else if (denied) {
    body = <p>{DENIED_HELP}</p>;
  } else {
    body = (
      <>
        <p className="muted">Receba o lembrete das 21h e os avisos de contas a vencer.</p>
        <button type="button" className="btn" disabled={busy} onClick={() => void enable()}>
          Ativar notificações
        </button>
      </>
    );
  }

  const devices = subs.data?.map((s) => s.device_label ?? "Aparelho").join(", ");
  return (
    <section aria-labelledby="notifications-title" className="card">
      <h2 id="notifications-title">Notificações</h2>
      {body}
      {usable && devices ? <p className="muted">Aparelhos cadastrados: {devices}</p> : null}
      <p role="status" aria-live="polite" className={message ? undefined : "muted"}>
        {message}
      </p>
    </section>
  );
}
