import { Button, ErrorState, LoadingState, Sheet } from "../../ui";
import { useLoan, useLoanAccountId } from "../debts/api";
import { PayInstallmentsSheet } from "../debts/PayInstallmentsSheet";

interface Props {
  debtId: number;
  billInstanceId: number;
  onClose: () => void;
}

/** Paga a parcela de empréstimo de uma conta a pagar: reaproveita o formulário de revisar pagamento com 1 parcela. */
export function LoanBillPay({ debtId, billInstanceId, onClose }: Props) {
  const loan = useLoan(debtId);
  const account = useLoanAccountId(debtId);
  const item = loan.data?.items.find((i) => i.bill_instance_id === billInstanceId);

  if (item && account.data !== undefined) {
    return (
      <PayInstallmentsSheet open debtId={debtId} selected={[item]} defaultAccountId={account.data} onClose={onClose} onDone={onClose} />
    );
  }
  const failed = loan.isError || account.isError || (loan.data && !item);
  return (
    <Sheet open title="Revisar pagamento" onClose={onClose}>
      {failed ? (
        <ErrorState
          message="Não foi possível carregar a parcela."
          onRetry={() => {
            void loan.refetch();
            void account.refetch();
          }}
        />
      ) : (
        <LoadingState label="Carregando parcela…" />
      )}
      <Button block onClick={onClose}>
        Fechar
      </Button>
    </Sheet>
  );
}
