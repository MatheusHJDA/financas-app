import { useQuery } from "@tanstack/react-query";
import { ErrorState, LoadingState } from "../../ui/States";
import { fetchSystem, SYSTEM_KEY } from "./adminApi";
import { formatBytes, formatDateTime } from "./format";

export function SystemSection() {
  const system = useQuery({ queryKey: SYSTEM_KEY, queryFn: fetchSystem });

  if (system.isLoading) return <LoadingState label="Carregando estado do sistema…" />;
  if (system.isError || !system.data) {
    return <ErrorState message="Não foi possível carregar o estado do sistema." onRetry={() => void system.refetch()} />;
  }

  const { database_ok, scheduler_ok, last_backup_at, last_backup_size_bytes } = system.data;
  const hasBackup = !!last_backup_at;

  return (
    <section aria-labelledby="admin-system-title" className="card">
      <h2 id="admin-system-title">Sistema</h2>
      <dl className="admin-stats">
        <div>
          <dt>Banco de dados</dt>
          <dd className={database_ok ? "admin-notice--ok" : "admin-notice--error"}>{database_ok ? "OK" : "Com problema"}</dd>
        </div>
        <div>
          <dt>Agendador de avisos</dt>
          <dd className={scheduler_ok ? "admin-notice--ok" : "admin-notice--error"}>{scheduler_ok ? "OK" : "Parado"}</dd>
        </div>
        <div>
          <dt>Último backup</dt>
          <dd>
            {hasBackup
              ? `${formatDateTime(last_backup_at)}${last_backup_size_bytes != null ? ` · ${formatBytes(last_backup_size_bytes)}` : ""}`
              : "Nenhum backup encontrado"}
          </dd>
        </div>
      </dl>
      <div className="admin-actions admin-actions--stack">
        <a className="btn admin-link" href="/api/transactions/export.csv" download>
          Exportar lançamentos (CSV)
        </a>
        {hasBackup ? (
          <a className="btn admin-link" href="/api/admin/backups/latest" download>
            Baixar backup
          </a>
        ) : null}
        <button type="button" className="btn" onClick={() => void system.refetch()} disabled={system.isFetching}>
          Atualizar estado
        </button>
      </div>
    </section>
  );
}
