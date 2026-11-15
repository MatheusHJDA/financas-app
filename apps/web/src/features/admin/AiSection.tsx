import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertCircle, CircleDollarSign, Cpu, Gauge } from "lucide-react";
import { Avatar, Card, ListItem, StatCard } from "../../ui";
import { EmptyState, ErrorState } from "../../ui/States";
import { DESKTOP_QUERY, useMediaQuery } from "../../ui/useMediaQuery";
import { aiKey, fetchAiCalls, fetchUsers, USERS_KEY, type AiCall } from "./adminApi";
import { formatDateTime, formatInt, formatUsdCents } from "./format";
import { Pager } from "./Pager";
import { SectionSkeleton } from "./SectionSkeleton";

// Códigos gravados por ai/client.py: "ai_limit_reached" = limite/429 da OpenAI.
const isFailure = (call: AiCall) => call.status !== "ok";
const isLimit = (call: AiCall) => /429|limit/i.test(call.error_code ?? "");

const statusText = (call: AiCall) =>
  isFailure(call) ? `Falha${call.error_code ? ` (${call.error_code})` : ""}` : "Ok";

export function AiSection() {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const [offset, setOffset] = useState(0);
  const calls = useQuery({
    queryKey: aiKey(offset),
    queryFn: () => fetchAiCalls(offset),
    placeholderData: keepPreviousData,
  });
  const users = useQuery({ queryKey: USERS_KEY, queryFn: fetchUsers });

  if (calls.isLoading) return <SectionSkeleton label="Carregando chamadas de IA…" stats={4} rows={4} />;
  if (calls.isError || !calls.data) {
    return <ErrorState message="Não foi possível carregar as chamadas de IA." onRetry={() => void calls.refetch()} />;
  }

  const { items, total } = calls.data;
  const nameOf = new Map((users.data ?? []).map((u) => [u.id, u.name]));
  const failures = items.filter(isFailure).length;
  const limits = items.filter(isLimit).length;

  return (
    <>
      <div className="admin-stat-grid" role="group" aria-label="Resumo das chamadas desta página">
        <StatCard label="Total de chamadas" icon={Cpu} tone="info" value={formatInt(total)} />
        <StatCard label="Falhas na página" icon={AlertCircle} tone={failures > 0 ? "expense" : "neutral"} value={formatInt(failures)} />
        <StatCard label="Limites 429 na página" icon={Gauge} tone={limits > 0 ? "warning" : "neutral"} value={formatInt(limits)} />
        {/* O custo vem pronto da API (estimativa em centavos de dólar); o front não soma. */}
        <StatCard
          label="Custo da última chamada"
          icon={CircleDollarSign}
          tone="neutral"
          value={formatUsdCents(items[0]?.est_cost_cents)}
          hint="Estimado, da chamada mais recente da página"
        />
      </div>

      <Card title="Chamadas de IA" icon={Cpu}>
      {items.length === 0 ? (
        <EmptyState title="Nenhuma chamada de IA ainda" />
      ) : !desktop ? (
        <ul className="admin-list">
          {items.map((call) => (
            <li key={call.id}>
              <ListItem
                leading={<Avatar name={nameOf.get(call.user_id) ?? "?"} tone={isFailure(call) ? "expense" : "income"} />}
                title={call.model}
                subtitle={
                  <>
                    <span className="admin-line">
                      {nameOf.get(call.user_id) ?? `Usuário ${call.user_id}`} · {formatDateTime(call.created_at)}
                    </span>
                    <span className="admin-line">{formatInt(call.usage_tokens)} tokens</span>
                    <span className={isFailure(call) ? "admin-line admin-notice--error" : "admin-line"}>
                      {statusText(call)}
                    </span>
                  </>
                }
                trailing={<span className="admin-cost">{formatUsdCents(call.est_cost_cents)}</span>}
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="admin-scroll" role="region" aria-label="Tabela de chamadas de IA" tabIndex={0}>
          <table className="admin-table" aria-label="Chamadas de IA">
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Usuário</th>
                <th scope="col">Modelo</th>
                <th scope="col">Tokens</th>
                <th scope="col">Custo estimado (US$)</th>
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
                  <td>{formatUsdCents(call.est_cost_cents)}</td>
                  <td className={isFailure(call) ? "admin-notice--error" : undefined}>{statusText(call)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager offset={offset} count={items.length} total={total} onChange={setOffset} />
      </Card>
    </>
  );
}
