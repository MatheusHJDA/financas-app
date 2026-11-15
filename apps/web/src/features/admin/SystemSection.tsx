import { useQuery } from "@tanstack/react-query";
import { Activity, Database, DatabaseBackup, Download, FileSpreadsheet, RefreshCw } from "lucide-react";
import { Button, Card, StatCard } from "../../ui";
import { ErrorState } from "../../ui/States";
import { fetchSystem, SYSTEM_KEY } from "./adminApi";
import { formatBytes, formatDateTime } from "./format";
import { SectionSkeleton } from "./SectionSkeleton";

export function SystemSection() {
  const system = useQuery({ queryKey: SYSTEM_KEY, queryFn: fetchSystem });

  if (system.isLoading) return <SectionSkeleton label="Carregando estado do sistema…" stats={3} rows={1} />;
  if (system.isError || !system.data) {
    return <ErrorState message="Não foi possível carregar o estado do sistema." onRetry={() => void system.refetch()} />;
  }

  const { database_ok, scheduler_ok, last_backup_at, last_backup_size_bytes } = system.data;
  const hasBackup = !!last_backup_at;

  return (
    <>
      <div className="admin-stat-grid">
        <StatCard
          label="Banco de dados"
          icon={Database}
          tone={database_ok ? "income" : "expense"}
          value={database_ok ? "OK" : "Com problema"}
        />
        <StatCard
          label="Agendador de avisos"
          icon={Activity}
          tone={scheduler_ok ? "income" : "expense"}
          value={scheduler_ok ? "OK" : "Parado"}
        />
        <StatCard
          label="Último backup"
          icon={DatabaseBackup}
          tone={hasBackup ? "info" : "warning"}
          value={
            hasBackup
              ? `${formatDateTime(last_backup_at)}${last_backup_size_bytes != null ? ` · ${formatBytes(last_backup_size_bytes)}` : ""}`
              : "Nenhum backup encontrado"
          }
        />
      </div>
      <Card title="Dados e backup" icon={Download}>
        <div className="admin-actions admin-actions--row">
          <a className="ui-btn ui-btn--secondary admin-link" href="/api/transactions/export.csv" download>
            <FileSpreadsheet aria-hidden="true" size={18} strokeWidth={1.75} />
            Exportar lançamentos (CSV)
          </a>
          {hasBackup ? (
            <a className="ui-btn ui-btn--secondary admin-link" href="/api/admin/backups/latest" download>
              <Download aria-hidden="true" size={18} strokeWidth={1.75} />
              Baixar backup
            </a>
          ) : null}
          <Button icon={RefreshCw} onClick={() => void system.refetch()} disabled={system.isFetching}>
            Atualizar estado
          </Button>
        </div>
      </Card>
    </>
  );
}
