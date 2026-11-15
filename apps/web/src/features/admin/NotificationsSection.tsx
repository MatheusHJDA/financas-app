import { useQuery } from "@tanstack/react-query";
import { Send, Smartphone } from "lucide-react";
import { useRef, useState } from "react";
import { Avatar, Button, Card, ListItem } from "../../ui";
import { EmptyState, ErrorState } from "../../ui/States";
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
import { SectionSkeleton } from "./SectionSkeleton";

/** "Avisos do sistema": teste de envio e aparelhos inscritos (antes, "Notificações"). */
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

  if (users.isLoading || subs.isLoading) return <SectionSkeleton label="Carregando avisos…" rows={3} />;
  if (users.isError || subs.isError || !users.data || !subs.data) {
    return (
      <ErrorState
        message="Não foi possível carregar os avisos."
        onRetry={() => {
          void users.refetch();
          void subs.refetch();
        }}
      />
    );
  }

  const nameOf = new Map(users.data.map((u) => [u.id, u.name]));

  return (
    <div className="admin-columns">
      <Card title="Enviar notificação de teste" icon={Send}>
        <div className="admin-actions admin-actions--stack">
          {users.data.map((user) => (
            <Button key={user.id} disabled={sendingId !== null} onClick={() => void sendTest(user.id, user.name)}>
              {sendingId === user.id ? "Enviando…" : `Enviar teste para ${user.name}`}
            </Button>
          ))}
        </div>
        <Notice notice={notice} />
      </Card>

      <Card title="Aparelhos com notificação" icon={Smartphone}>
        {subs.data.length === 0 ? (
          <EmptyState title="Nenhum aparelho inscrito" hint="Cada pessoa ativa as notificações em Preferências." />
        ) : (
          <ul className="admin-list">
            {subs.data.map((sub) => {
              const owner = nameOf.get(sub.user_id) ?? `Usuário ${sub.user_id}`;
              return (
                <li key={sub.id}>
                  <ListItem
                    leading={<Avatar name={owner} tone="info" />}
                    title={sub.device_label || "Aparelho sem nome"}
                    subtitle={
                      <>
                        <span className="admin-line">
                          {owner} · inscrito em {formatDateTime(sub.created_at)}
                        </span>
                        <span className="admin-line">
                          {sub.last_ok_at
                            ? `Último envio com sucesso: ${formatDateTime(sub.last_ok_at)}`
                            : "Ainda sem envio com sucesso"}
                        </span>
                      </>
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
