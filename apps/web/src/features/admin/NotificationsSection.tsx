import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../../ui/States";
import {
  errorText,
  fetchSubscriptions,
  fetchUsers,
  sendTestNotification,
  SUBSCRIPTIONS_KEY,
  USERS_KEY,
} from "./adminApi";
import { formatDateTime } from "./format";
import { Notice, type NoticeValue } from "./Notice";

export function NotificationsSection() {
  const users = useQuery({ queryKey: USERS_KEY, queryFn: fetchUsers });
  const subs = useQuery({ queryKey: SUBSCRIPTIONS_KEY, queryFn: fetchSubscriptions });
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<NoticeValue | null>(null);
  const busyRef = useRef(false);

  async function sendTest(userId: number, name: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setSendingId(userId);
    setNotice(null);
    try {
      const sent = await sendTestNotification(userId);
      setNotice({
        kind: sent > 0 ? "ok" : "error",
        text:
          sent > 0
            ? `Teste enviado para ${name}: ${sent} ${sent === 1 ? "aparelho recebeu" : "aparelhos receberam"}.`
            : `Teste para ${name}: 0 aparelhos receberam. A pessoa precisa ativar as notificações no celular.`,
      });
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error, "Não foi possível enviar o teste. Tente de novo.") });
    } finally {
      busyRef.current = false;
      setSendingId(null);
    }
  }

  if (users.isLoading || subs.isLoading) return <LoadingState label="Carregando notificações…" />;
  if (users.isError || subs.isError || !users.data || !subs.data) {
    return (
      <ErrorState
        message="Não foi possível carregar as notificações."
        onRetry={() => {
          void users.refetch();
          void subs.refetch();
        }}
      />
    );
  }

  const nameOf = new Map(users.data.map((u) => [u.id, u.name]));

  return (
    <>
      <section aria-labelledby="admin-test-title" className="card">
        <h2 id="admin-test-title">Enviar notificação de teste</h2>
        <div className="admin-actions admin-actions--stack">
          {users.data.map((user) => (
            <button
              key={user.id}
              type="button"
              className="btn"
              disabled={sendingId !== null}
              onClick={() => void sendTest(user.id, user.name)}
            >
              {sendingId === user.id ? "Enviando…" : `Enviar teste para ${user.name}`}
            </button>
          ))}
        </div>
        <Notice notice={notice} />
      </section>

      <section aria-labelledby="admin-devices-title" className="card">
        <h2 id="admin-devices-title">Aparelhos com notificação</h2>
        {subs.data.length === 0 ? (
          <EmptyState title="Nenhum aparelho inscrito" hint="Cada pessoa ativa as notificações na aba Mais." />
        ) : (
          <ul className="admin-list">
            {subs.data.map((sub) => (
              <li key={sub.id} className="admin-item">
                <h3>{sub.device_label || "Aparelho sem nome"}</h3>
                <p className="muted">
                  {nameOf.get(sub.user_id) ?? `Usuário ${sub.user_id}`} · inscrito em {formatDateTime(sub.created_at)}
                </p>
                <p className="muted">
                  {sub.last_ok_at ? `Último envio com sucesso: ${formatDateTime(sub.last_ok_at)}` : "Ainda sem envio com sucesso"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
