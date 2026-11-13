import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../../ui/States";
import { formatCents } from "../chat/money";
import { aiKey, fetchAiCalls, fetchUsers, USERS_KEY, type AiCall } from "./adminApi";
import { formatDateTime, formatInt } from "./format";
import { Pager } from "./Pager";

// Códigos gravados por ai/client.py: "ai_limit_reached" = limite/429 da OpenAI.
const isFailure = (call: AiCall) => call.status !== "ok";
const isLimit = (call: AiCall) => /429|limit/i.test(call.error_code ?? "");

export function AiSection() {
  const [offset, setOffset] = useState(0);
  const calls = useQuery({
    queryKey: aiKey(offset),
    queryFn: () => fetchAiCalls(offset),
    placeholderData: keepPreviousData,
  });
  const users = useQuery({ queryKey: USERS_KEY, queryFn: fetchUsers });

  if (calls.isLoading) return <LoadingState label="Carregando chamadas de IA…" />;
  if (calls.isError || !calls.data) {
    return <ErrorState message="Não foi possível carregar as chamadas de IA." onRetry={() => void calls.refetch()} />;
  }

  const { items, total } = calls.data;
  const nameOf = new Map((users.data ?? []).map((u) => [u.id, u.name]));
  const failures = items.filter(isFailure).length;
  const limits = items.filter(isLimit).length;

  return (
    <section aria-labelledby="admin-ai-title" className="card">
      <h2 id="admin-ai-title">Chamadas de IA</h2>
      <dl className="admin-stats" aria-label="Resumo das chamadas desta página">
        <div>
          <dt>Total de chamadas</dt>
          <dd>{formatInt(total)}</dd>
        </div>
        <div>
          <dt>Falhas na página</dt>
          <dd>{formatInt(failures)}</dd>
        </div>
        <div>
          <dt>Limites 429 na página</dt>
          <dd>{formatInt(limits)}</dd>
        </div>
      </dl>

      {items.length === 0 ? (
        <EmptyState title="Nenhuma chamada de IA ainda" />
      ) : (
        <div className="admin-scroll" role="region" aria-label="Tabela de chamadas de IA" tabIndex={0}>
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Usuário</th>
                <th scope="col">Modelo</th>
                <th scope="col">Tokens</th>
                <th scope="col">Custo estimado</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((call) => (
                <tr key={call.id}>
                  <td>{formatDateTime(call.created_at)}</td>
                  <td>{nameOf.get(call.user_id) ?? `Usuário ${call.user_id}`}</td>
                  <td>{call.model}</td>
                  <td>{formatInt(call.usage_tokens)}</td>
                  <td>{call.est_cost_cents === null || call.est_cost_cents === undefined ? "—" : formatCents(call.est_cost_cents)}</td>
                  <td className={isFailure(call) ? "admin-notice--error" : undefined}>
                    {isFailure(call) ? `Falha${call.error_code ? ` (${call.error_code})` : ""}` : "Ok"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager offset={offset} count={items.length} total={total} onChange={setOffset} />
    </section>
  );
}
