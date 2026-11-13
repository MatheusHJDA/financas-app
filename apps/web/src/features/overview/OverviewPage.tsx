import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { ErrorState, LoadingState } from "../../ui/States";
import { AccountsSection } from "../accounts/AccountsSection";
import { BillsSection } from "../bills/BillsSection";
import { BalancesSection } from "./BalancesSection";
import { TransactionsSection } from "./TransactionsSection";
import "../accounts/ui.css";

async function loadOverview() {
  const { data, response } = await api.GET("/overview");
  if (!data) throw new Error(`HTTP ${response.status}`);
  return data;
}

// Dono: U8. Tela Geral: saldos, contas a pagar, movimentações e cadastro de contas.
export default function OverviewPage() {
  const overview = useQuery({ queryKey: ["overview"], queryFn: loadOverview });

  return (
    <section className="u8-page">
      <h1>Geral</h1>
      {overview.isLoading ? <LoadingState label="Carregando saldos…" /> : null}
      {overview.isError ? (
        <ErrorState message="Não foi possível carregar a visão geral." onRetry={() => void overview.refetch()} />
      ) : null}
      {overview.data ? (
        <>
          <BalancesSection overview={overview.data} />
          <BillsSection upcoming={overview.data.upcoming_bills} overdue={overview.data.overdue_bills} />
        </>
      ) : null}
      <TransactionsSection />
      <AccountsSection />
    </section>
  );
}
