import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { ErrorState, LoadingState } from "../../ui/States";
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

type Pending = { userId: number; kind: "pin" | "sessions" };

const PIN_PATTERN = new RegExp(`^[0-9]{${PIN_LENGTH}}$`);

export function UsersSection() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: USERS_KEY, queryFn: fetchUsers });
  const [pending, setPending] = useState<Pending | null>(null);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const pinReady = PIN_PATTERN.test(pin) && pin === pin2;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeValue | null>(null);
  const busyRef = useRef(false);

  function open(next: Pending) {
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
        setNotice({ kind: "ok", text: `PIN de ${user.name} redefinido. As sessões antigas foram encerradas.` });
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

  if (users.isLoading) return <LoadingState label="Carregando usuários…" />;
  if (users.isError || !users.data) {
    return <ErrorState message="Não foi possível carregar os usuários." onRetry={() => void users.refetch()} />;
  }

  return (
    <section aria-labelledby="admin-users-title" className="card">
      <h2 id="admin-users-title">Usuários</h2>
      <Notice notice={notice} />
      <ul className="admin-list">
        {users.data.map((user) => {
          const locked = isLocked(user.locked_until);
          const mine = user.id === me?.id;
          const active = pending?.userId === user.id ? pending : null;
          return (
            <li key={user.id}>
              <article aria-label={user.name} className="admin-item">
                <h3>
                  {user.name} <span className="muted">· {user.role === "admin" ? "Administrador" : "Membro"}</span>
                </h3>
                <p className={locked ? "admin-notice--error" : "muted"}>
                  {locked ? `Bloqueado até ${formatDateTime(user.locked_until)}` : "Sem bloqueio"}
                  {user.failed_attempts > 0 ? ` · ${user.failed_attempts} tentativa(s) errada(s)` : ""}
                </p>

                {active ? (
                  <form
                    className="admin-confirm"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void confirm(user);
                    }}
                  >
                    {active.kind === "pin" ? (
                      <>
                        <label htmlFor={`pin-${user.id}`}>Novo PIN de {user.name} ({PIN_LENGTH} dígitos)</label>
                        <input
                          id={`pin-${user.id}`}
                          inputMode="numeric"
                          autoComplete="off"
                          maxLength={PIN_LENGTH}
                          value={pin}
                          onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, "").slice(0, PIN_LENGTH))}
                        />
                        <label htmlFor={`pin2-${user.id}`}>Repita o novo PIN</label>
                        <input
                          id={`pin2-${user.id}`}
                          inputMode="numeric"
                          autoComplete="off"
                          maxLength={PIN_LENGTH}
                          value={pin2}
                          onChange={(e) => setPin2(e.target.value.replace(/[^0-9]/g, "").slice(0, PIN_LENGTH))}
                        />
                        {pin2.length === PIN_LENGTH && pin !== pin2 ? (
                          <p className="admin-notice--error" role="alert">
                            Os dois PINs não são iguais.
                          </p>
                        ) : null}
                        <p className="muted">
                          Confirma trocar o PIN de {user.name}? O PIN antigo deixa de valer e as sessões
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
                      <button
                        type="submit"
                        className="btn btn--primary"
                        disabled={busy || (active.kind === "pin" && !pinReady)}
                      >
                        {active.kind === "pin" ? "Confirmar redefinição" : "Confirmar encerramento"}
                      </button>
                      <button type="button" className="btn" onClick={close} disabled={busy}>
                        Cancelar
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="admin-actions">
                    <button
                      type="button"
                      className="btn"
                      aria-label={`Redefinir PIN de ${user.name}`}
                      onClick={() => open({ userId: user.id, kind: "pin" })}
                    >
                      Redefinir PIN
                    </button>
                    <button
                      type="button"
                      className="btn"
                      aria-label={`Encerrar sessões de ${user.name}`}
                      onClick={() => open({ userId: user.id, kind: "sessions" })}
                    >
                      Encerrar sessões
                    </button>
                  </div>
                )}
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
