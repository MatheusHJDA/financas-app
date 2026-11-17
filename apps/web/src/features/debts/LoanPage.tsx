import { useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Button, ErrorState, Money, Skeleton, SkeletonGroup } from "../../ui";
import { useDebts, useLoan, useLoanAccountId, type Installment } from "./api";
import { InstallmentList } from "./InstallmentList";
import { PayInstallmentsSheet } from "./PayInstallmentsSheet";
import "./loan.css";

/** `/dividas`: abre a primeira dívida com parcelas; sem nenhuma, volta ao início. */
export function DebtsRedirect() {
  const debts = useDebts();
  if (debts.isError) return <ErrorState message="Não foi possível carregar as dívidas." onRetry={() => void debts.refetch()} />;
  if (!debts.data) return <LoanSkeleton />;
  const first = debts.data.find((d) => d.has_installments);
  return <Navigate to={first ? `/dividas/${first.id}` : "/"} replace />;
}

function LoanSkeleton() {
  return (
    <SkeletonGroup label="Carregando empréstimo…">
      <div className="loan-page">
        <Skeleton height="96px" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height="56px" />
        ))}
      </div>
    </SkeletonGroup>
  );
}

// Tela do empréstimo: resumo, parcelas com caixa de seleção e barra de pagamento/adiantamento.
export default function LoanPage() {
  const id = Number(useParams().id);
  const loan = useLoan(id);
  const debts = useDebts();
  const accountId = useLoanAccountId(id);
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [reviewing, setReviewing] = useState<Installment[] | null>(null);
  const [notice, setNotice] = useState("");

  if (loan.isError) return <ErrorState message="Não foi possível carregar o empréstimo." onRetry={() => void loan.refetch()} />;
  if (!loan.data) return <LoanSkeleton />;

  const { items, remaining_cents, paid_cents, payoff_today_cents } = loan.data;
  const name = debts.data?.find((d) => d.id === id)?.name ?? "Empréstimo";

  if (items.length === 0) {
    return (
      <div className="loan-page">
        <h1 className="loan-title">{name}</h1>
        <section className="loan-summary">
          <p className="loan-stat loan-stat--main">
            <span className="muted">Saldo devedor</span>
            <Money cents={remaining_cents} className="loan-stat__big" />
          </p>
          <p className="muted">Esta dívida não tem parcelas cadastradas.</p>
        </section>
      </div>
    );
  }

  // Só conta como escolhida a parcela que continua aberta (a lista pode ter sido recarregada).
  const chosen = items.filter((i) => i.status === "open" && picked.has(i.id));
  const total = chosen.reduce((s, i) => s + (i.today_cents ?? i.face_cents), 0);
  const savings = chosen.reduce((s, i) => s + (i.savings_cents ?? 0), 0);

  const toggle = (itemId: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(itemId)) next.add(itemId);
      return next;
    });

  const done = () => {
    setReviewing(null);
    setPicked(new Set());
    setNotice("Pagamento registrado.");
  };

  return (
    <div className={chosen.length > 0 ? "loan-page loan-page--bar" : "loan-page"}>
      <h1 className="loan-title">{name}</h1>
      <section className="loan-summary" aria-label="Resumo do empréstimo">
        <p className="loan-stat loan-stat--main">
          <span className="muted">Restante a pagar</span>
          <Money cents={remaining_cents} className="loan-stat__big" />
        </p>
        <div className="loan-stats">
          <p className="loan-stat">
            <span className="muted">Total pago</span>
            <Money cents={paid_cents} />
          </p>
          <p className="loan-stat">
            <span className="muted">Quitar hoje (estimativa)</span>
            <Money cents={payoff_today_cents} />
          </p>
        </div>
      </section>
      <p className="u8-sr" role="status" aria-live="polite">
        {notice}
      </p>
      <InstallmentList items={items} selected={picked} onToggle={toggle} />

      {chosen.length > 0 ? (
        <section className="loan-bar" aria-label="Parcelas selecionadas">
          <div className="loan-bar__text">
            <span className="muted">{chosen.length === 1 ? "1 parcela" : `${chosen.length} parcelas`}</span>
            <Money cents={total} className="loan-bar__total" />
            {savings > 0 ? (
              <span className="loan-bar__save">
                Você economiza <Money cents={savings} />
              </span>
            ) : null}
          </div>
          <Button variant="primary" onClick={() => setReviewing(chosen)}>
            Revisar
          </Button>
        </section>
      ) : null}

      {reviewing ? (
        <PayInstallmentsSheet
          open
          debtId={id}
          selected={reviewing}
          defaultAccountId={accountId.data ?? null}
          onClose={() => setReviewing(null)}
          onDone={done}
        />
      ) : null}
    </div>
  );
}
