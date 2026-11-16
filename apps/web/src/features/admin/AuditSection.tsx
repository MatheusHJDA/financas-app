import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Filter, ScrollText } from "lucide-react";
import { Avatar, Button, Card, ListItem } from "../../ui";
import { EmptyState, ErrorState } from "../../ui/States";
import { DESKTOP_QUERY, useMediaQuery } from "../../ui/useMediaQuery";
import { auditKey, fetchAudit, fetchUsers, USERS_KEY, type AuditEvent } from "./adminApi";
import { formatDateTime } from "./format";
import { Pager } from "./Pager";
import { SectionSkeleton } from "./SectionSkeleton";

const ACTIONS: Record<string, string> = { create: "Criou", update: "Alterou", delete: "Excluiu" };

export function AuditSection() {
  const desktop = useMediaQuery(DESKTOP_QUERY);
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

  const who = (event: AuditEvent) =>
    event.user_id === null || event.user_id === undefined
      ? "Sistema"
      : (nameOf.get(event.user_id) ?? `Usuário ${event.user_id}`);
  const what = (event: AuditEvent) => `${ACTIONS[event.action] ?? event.action} ${event.entity} #${event.entity_id}`;
  const details = (event: AuditEvent) =>
    event.before || event.after ? (
      <details>
        <summary>
          Ver detalhes <span className="visually-hidden">de {what(event)}</span>
        </summary>
        {event.before ? <pre className="admin-json">Antes: {JSON.stringify(event.before, null, 2)}</pre> : null}
        {event.after ? <pre className="admin-json">Depois: {JSON.stringify(event.after, null, 2)}</pre> : null}
      </details>
    ) : null;

  return (
    <Card title="Eventos registrados" icon={ScrollText}>
      <form
        className="admin-form admin-form--filters"
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
        <Button type="submit" variant="primary" icon={Filter}>
          Filtrar
        </Button>
      </form>

      {audit.isLoading ? <SectionSkeleton label="Carregando auditoria…" rows={4} /> : null}
      {audit.isError ? (
        <ErrorState message="Não foi possível carregar a auditoria." onRetry={() => void audit.refetch()} />
      ) : null}
      {audit.data ? (
        <>
          {audit.data.items.length === 0 ? (
            <EmptyState title="Nenhum evento encontrado" />
          ) : desktop ? (
            <div className="admin-scroll" role="region" aria-label="Tabela de eventos de auditoria" tabIndex={0}>
              <table className="admin-table admin-table--wrap" aria-label="Eventos de auditoria">
                <thead>
                  <tr>
                    <th scope="col">Quando</th>
                    <th scope="col">Quem</th>
                    <th scope="col">O quê</th>
                    <th scope="col">Detalhes</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.data.items.map((event) => (
                    <tr key={event.id}>
                      <td>{formatDateTime(event.at)}</td>
                      <td>{who(event)}</td>
                      <td>{what(event)}</td>
                      <td>{details(event) ?? <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ul className="admin-list">
              {audit.data.items.map((event) => (
                <li key={event.id} className="admin-item">
                  <ListItem
                    leading={<Avatar name={who(event)} tone="neutral" />}
                    title={what(event)}
                    subtitle={
                      <>
                        {who(event)} · {formatDateTime(event.at)}
                      </>
                    }
                  />
                  {details(event)}
                </li>
              ))}
            </ul>
          )}
          <Pager offset={offset} count={audit.data.items.length} total={audit.data.total} onChange={setOffset} />
        </>
      ) : null}
    </Card>
  );
}
