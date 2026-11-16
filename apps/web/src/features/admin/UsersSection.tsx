import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut, Users } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { Avatar, Button, Card, ListItem } from "../../ui";
import { ErrorState } from "../../ui/States";
import { DESKTOP_QUERY, useMediaQuery } from "../../ui/useMediaQuery";
import {
  errorText,
  fetchUsers,
  PIN_LENGTH,
  resetPin,
  revokeSessions,
  USERS_KEY,
  type AdminUser,
} from "./adminApi";
import { formatDateTime, isLocked } from "./format";
import { Notice, type NoticeValue } from "./Notice";
import { SectionSkeleton } from "./SectionSkeleton";

type Pending = { userId: number; kind: "pin" | "sessions" };

const PIN_PATTERN = new RegExp(`^[0-9]{${PIN_LENGTH}}$`);

const roleLabel = (user: AdminUser) =>
  user.role === "admin" ? "Administrador" : "Membro";

export function UsersSection() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const users = useQuery({ queryKey: USERS_KEY, queryFn: fetchUsers });
  const [pending, setPending] = useState<Pending | null>(null);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const pinReady = PIN_PATTERN.test(pin) && pin === pin2;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeValue | null>(null);
  const busyRef = useRef(false);
  const lastOpened = useRef<Pending | null>(null);

  // Foco: ao abrir a confirmação vai para o campo do PIN (ou para "Cancelar", na opção
  // sem campo); ao fechar, volta ao botão que abriu (que é recriado ao reaparecer).
  useEffect(() => {
    if (pending) {
      const target =
        pending.kind === "pin"
          ? document.getElementById(`pin-${pending.userId}`)
          : document.querySelector<HTMLElement>("[data-admin-cancel]");
      target?.focus();
    } else if (lastOpened.current) {
      const { userId, kind } = lastOpened.current;
      document.querySelector<HTMLElement>(`[data-admin-action="${userId}-${kind}"]`)?.focus();
      lastOpened.current = null;
    }
  }, [pending]);

  function open(next: Pending) {
    lastOpened.current = next;
    setPending(next);
    setPin("");
    setPin2("");
    setNotice(null);
  }

  function close() {
    setPending(null);
    setPin("");
    setPin2("");
  }

  async function confirm(user: AdminUser) {
    if (!pending || busyRef.current) return;
    if (pending.kind === "pin" && !pinReady) return;
    busyRef.current = true;
    setBusy(true);
    try {
      if (pending.kind === "pin") {
        await resetPin(user.id, pin);
        setNotice({
          kind: "ok",
          text: `PIN de ${user.name} redefinido. As sessões antigas foram encerradas.`,
        });
      } else {
        await revokeSessions(user.id);
        setNotice({ kind: "ok", text: `Sessões de ${user.name} encerradas.` });
      }
      close();
      await queryClient.invalidateQueries({ queryKey: USERS_KEY });
    } catch (error) {
      setNotice({
        kind: "error",
        text: errorText(error, "Não foi possível concluir. Tente de novo."),
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (users.isLoading)
    return <SectionSkeleton label="Carregando usuários…" rows={2} />;
  if (users.isError || !users.data) {
    return (
      <ErrorState
        message="Não foi possível carregar os usuários."
        onRetry={() => void users.refetch()}
      />
    );
  }

  const lockText = (user: AdminUser) =>
    isLocked(user.locked_until)
      ? `Bloqueado até ${formatDateTime(user.locked_until)}`
      : "Sem bloqueio";
  const attemptsText = (user: AdminUser) =>
    user.failed_attempts > 0
      ? `${user.failed_attempts} tentativa(s) errada(s)`
      : null;

  function confirmForm(user: AdminUser, active: Pending) {
    const mine = user.id === me?.id;
    return (
      <form
        className="admin-confirm"
        onSubmit={(e) => {
          e.preventDefault();
          void confirm(user);
        }}
      >
        {active.kind === "pin" ? (
          <>
            <div className="admin-field">
              <label htmlFor={`pin-${user.id}`}>
                Novo PIN de {user.name} ({PIN_LENGTH} dígitos)
              </label>
              <input
                id={`pin-${user.id}`}
                inputMode="numeric"
                autoComplete="off"
                maxLength={PIN_LENGTH}
                value={pin}
                onChange={(e) =>
                  setPin(
                    e.target.value.replace(/[^0-9]/g, "").slice(0, PIN_LENGTH),
                  )
                }
              />
            </div>
            <div className="admin-field">
              <label htmlFor={`pin2-${user.id}`}>Repita o novo PIN</label>
              <input
                id={`pin2-${user.id}`}
                inputMode="numeric"
                autoComplete="off"
                maxLength={PIN_LENGTH}
                value={pin2}
                onChange={(e) =>
                  setPin2(
                    e.target.value.replace(/[^0-9]/g, "").slice(0, PIN_LENGTH),
                  )
                }
              />
            </div>
            {pin2.length === PIN_LENGTH && pin !== pin2 ? (
              <p className="admin-notice--error" role="alert">
                Os dois PINs não são iguais.
              </p>
            ) : null}
            <p className="muted">
              Confirma trocar o PIN de {user.name}? O PIN antigo deixa de valer
              e as sessões
              {mine ? " dos outros aparelhos" : ""} são encerradas.
            </p>
          </>
        ) : (
          <p>
            Encerrar todas as sessões de {user.name}?
            {mine ? " Isso também encerra a sua sessão neste aparelho." : ""}
          </p>
        )}
        <div className="admin-actions">
          <Button
            type="submit"
            variant="primary"
            disabled={busy || (active.kind === "pin" && !pinReady)}
          >
            {active.kind === "pin"
              ? "Confirmar redefinição"
              : "Confirmar encerramento"}
          </Button>
          <Button onClick={close} disabled={busy} data-admin-cancel="">
            Cancelar
          </Button>
        </div>
      </form>
    );
  }

  function actions(user: AdminUser) {
    return (
      <div className="admin-actions">
        <Button
          icon={KeyRound}
          aria-label={`Redefinir PIN de ${user.name}`}
          data-admin-action={`${user.id}-pin`}
          onClick={() => open({ userId: user.id, kind: "pin" })}
        >
          Redefinir PIN
        </Button>
        <Button
          icon={LogOut}
          aria-label={`Encerrar sessões de ${user.name}`}
          data-admin-action={`${user.id}-sessions`}
          onClick={() => open({ userId: user.id, kind: "sessions" })}
        >
          Encerrar sessões
        </Button>
      </div>
    );
  }

  const activeFor = (user: AdminUser) =>
    pending?.userId === user.id ? pending : null;

  let body: ReactNode;
  if (desktop) {
    body = (
      <div className="admin-scroll" role="region" aria-label="Tabela de usuários" tabIndex={0}>
        <table className="admin-table" aria-label="Usuários">
          <thead>
            <tr>
              <th scope="col">Pessoa</th>
              <th scope="col">Papel</th>
              <th scope="col">Acesso</th>
              <th scope="col">Ações</th>
            </tr>
          </thead>
          <tbody>
            {users.data.map((user) => {
              const active = activeFor(user);
              const locked = isLocked(user.locked_until);
              return (
                <Fragment key={user.id}>
                  <tr>
                    <th scope="row" className="admin-cell-person">
                      <Avatar
                        name={user.name}
                        tone={user.role === "admin" ? "info" : "neutral"}
                      />
                      <span>{user.name}</span>
                    </th>
                    <td>
                      <span className="admin-badge">{roleLabel(user)}</span>
                    </td>
                    <td>
                      <span
                        className={locked ? "admin-notice--error" : "muted"}
                      >
                        {lockText(user)}
                      </span>
                      {attemptsText(user) ? (
                        <span className="muted"> · {attemptsText(user)}</span>
                      ) : null}
                    </td>
                    <td>
                      {active ? (
                        <span className="muted">Confirmando…</span>
                      ) : (
                        actions(user)
                      )}
                    </td>
                  </tr>
                  {active ? (
                    <tr className="admin-row-confirm">
                      <td colSpan={4}>{confirmForm(user, active)}</td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  } else {
    body = (
      <ul className="admin-list">
        {users.data.map((user) => {
          const locked = isLocked(user.locked_until);
          const active = activeFor(user);
          return (
            <li key={user.id}>
              <article aria-label={user.name} className="admin-item">
                <ListItem
                  leading={
                    <Avatar
                      name={user.name}
                      tone={user.role === "admin" ? "info" : "neutral"}
                    />
                  }
                  title={user.name}
                  subtitle={
                    <>
                      <span className="admin-badge">{roleLabel(user)}</span>{" "}
                      <span
                        className={locked ? "admin-notice--error" : undefined}
                      >
                        {lockText(user)}
                      </span>
                      {attemptsText(user) ? (
                        <span> · {attemptsText(user)}</span>
                      ) : null}
                    </>
                  }
                />
                {active ? confirmForm(user, active) : actions(user)}
              </article>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <Card title="Pessoas com acesso" icon={Users}>
      <Notice notice={notice} />
      {body}
    </Card>
  );
}
