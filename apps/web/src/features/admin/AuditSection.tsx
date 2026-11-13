import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../../ui/States";
import { auditKey, fetchAudit, fetchUsers, USERS_KEY } from "./adminApi";
import { formatDateTime } from "./format";
import { Pager } from "./Pager";

const ACTIONS: Record<string, string> = { create: "Criou", update: "Alterou", delete: "Excluiu" };

export function AuditSection() {
  const [entityInput, setEntityInput] = useState("");
  const [userInput, setUserInput] = useState("");
  const [filter, setFilter] = useState<{ entity: string; userId: number | null }>({ entity: "", userId: null });
  const [offset, setOffset] = useState(0);
  const users = useQuery({ queryKey: USERS_KEY, queryFn: fetchUsers });
  const audit = useQuery({
    queryKey: auditKey(filter.entity, filter.userId, offset),
    queryFn: () => fetchAudit(filter.entity, filter.userId, offset),
    placeholderData: keepPreviousData,
  });

  const nameOf = new Map((users.data ?? []).map((u) => [u.id, u.name]));

  return (
    <section aria-labelledby="admin-audit-title" className="card">
      <h2 id="admin-audit-title">Auditoria</h2>
      <form
        className="admin-form"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ entity: entityInput.trim(), userId: userInput ? Number(userInput) : null });
          setOffset(0);
        }}
      >
        <div className="admin-field">
          <label htmlFor="audit-entity">Entidade (ex.: transactions)</label>
          <input
            id="audit-entity"
            autoComplete="off"
            autoCapitalize="none"
            value={entityInput}
            onChange={(e) => setEntityInput(e.target.value)}
          />
        </div>
        <div className="admin-field">
          <label htmlFor="audit-user">Usuário</label>
          <select id="audit-user" value={userInput} onChange={(e) => setUserInput(e.target.value)}>
            <option value="">Todos</option>
            {(users.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn--primary">
          Filtrar
        </button>
      </form>

      {audit.isLoading ? <LoadingState label="Carregando auditoria…" /> : null}
      {audit.isError ? (
        <ErrorState message="Não foi possível carregar a auditoria." onRetry={() => void audit.refetch()} />
      ) : null}
      {audit.data ? (
        <>
          {audit.data.items.length === 0 ? (
            <EmptyState title="Nenhum evento encontrado" />
          ) : (
            <ul className="admin-list">
              {audit.data.items.map((event) => (
                <li key={event.id} className="admin-item">
                  <h3>
                    {ACTIONS[event.action] ?? event.action} {event.entity} #{event.entity_id}
                  </h3>
                  <p className="muted">
                    {event.user_id === null || event.user_id === undefined
                      ? "Sistema"
                      : (nameOf.get(event.user_id) ?? `Usuário ${event.user_id}`)}{" "}
                    · {formatDateTime(event.at)}
                  </p>
                  {event.before || event.after ? (
                    <details>
                      <summary>Ver detalhes</summary>
                      {event.before ? <pre className="admin-json">Antes: {JSON.stringify(event.before, null, 2)}</pre> : null}
                      {event.after ? <pre className="admin-json">Depois: {JSON.stringify(event.after, null, 2)}</pre> : null}
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <Pager offset={offset} count={audit.data.items.length} total={audit.data.total} onChange={setOffset} />
        </>
      ) : null}
    </section>
  );
}
