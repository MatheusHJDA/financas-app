import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { ConfirmBar } from "../accounts/ConfirmBar";
import { ApiError, OWNER_LABEL, assertOk, canWrite, errorMessage, type BillInstance } from "../accounts/shared";
import { formatDate } from "../chat/dates";
import { formatCents } from "../chat/money";
import { EmptyState } from "../../ui/States";
import "../accounts/ui.css";

interface Props {
  upcoming: BillInstance[];
  overdue: BillInstance[];
}

const PAID_PREFIXES = ["bill-instances", "overview", "transactions", "accounts", "goals"];

/** Contas a pagar (vencidas e próximos 15 dias). Só grava depois da confirmação. */
export function BillsSection({ upcoming, overdue }: Props) {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<number | null>(null);
  const [notice, setNotice] = useState("");

  const pay = useMutation({
    // POST sem corpo: o servidor cria a despesa na conta bancária da conta fixa.
    mutationFn: async (bill: BillInstance) => {
      const { response, error } = await api.POST("/bill-instances/{id}/pay", { params: { path: { id: bill.id } } });
      assertOk(response, error);
    },
    onSuccess: async (_d, bill) => {
      setConfirming(null);
      setNotice(`${bill.name ?? "Conta"} marcada como paga.`);
      await Promise.all(PAID_PREFIXES.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
    },
    onError: (error) => {
      // 409 ("já foi paga") e afins: a lista está velha, atualize.
      if (error instanceof ApiError && error.status === 409) void queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  const open = (bill: BillInstance) => {
    pay.reset();
    setNotice("");
    setConfirming(bill.id);
  };
  const close = () => {
    pay.reset();
    setConfirming(null);
  };

  const renderBill = (bill: BillInstance, late: boolean) => (
    <BillItem
      key={bill.id}
      bill={bill}
      late={late}
      editable={bill.owner == null ? true : canWrite(me, bill.owner)}
      confirming={confirming === bill.id}
      pay={pay}
      onAsk={() => open(bill)}
      onClose={close}
    />
  );

  return (
    <section className="u8-section" aria-labelledby="bills-title">
      <h2 id="bills-title">Contas a pagar</h2>
      <p className="u8-sr" role="status" aria-live="polite">
        {notice}
      </p>
      {overdue.length === 0 && upcoming.length === 0 ? (
        <EmptyState title="Nenhuma conta a pagar" hint="Nada vencido e nada nos próximos 15 dias." />
      ) : null}
      {overdue.length > 0 ? (
        <div className="u8-card" role="group" aria-label="Contas vencidas">
          <h3>Vencidas</h3>
          <ul className="u8-list">{overdue.map((b) => renderBill(b, true))}</ul>
        </div>
      ) : null}
      {upcoming.length > 0 ? (
        <div className="u8-card" role="group" aria-label="Próximos 15 dias" style={{ marginTop: "var(--space-3)" }}>
          <h3>Próximos 15 dias</h3>
          <ul className="u8-list">{upcoming.map((b) => renderBill(b, false))}</ul>
        </div>
      ) : null}
    </section>
  );
}

interface ItemProps {
  bill: BillInstance;
  late: boolean;
  editable: boolean;
  confirming: boolean;
  pay: { mutate: (bill: BillInstance) => void; isPending: boolean; error: unknown; isError: boolean };
  onAsk: () => void;
  onClose: () => void;
}

function BillItem({ bill, late, editable, confirming, pay, onAsk, onClose }: ItemProps) {
  const nameId = useId();
  const name = bill.name ?? "Conta";
  const error = confirming && pay.isError ? errorMessage(pay.error, "Você não pode pagar essa conta.") : null;
  const status = confirming && pay.isError && pay.error instanceof ApiError ? pay.error.status : 0;
  return (
    <li>
      <div className="u8-row">
        <div className="u8-grow">
          <strong id={nameId}>{name}</strong>
          <p className="muted u8-small" style={{ margin: 0 }}>
            {bill.owner ? `${OWNER_LABEL[bill.owner]} · ` : ""}
            vence em {formatDate(bill.due_date)}
            {late ? <span className="u8-badge u8-badge--warn" style={{ marginLeft: "var(--space-2)" }}>Vencida</span> : null}
          </p>
        </div>
        <span className="u8-amount">{formatCents(bill.amount_cents)}</span>
      </div>
      {editable && !confirming ? (
        <div className="u8-actions" style={{ marginTop: "var(--space-2)" }}>
          <button type="button" className="u8-btn" aria-describedby={nameId} onClick={onAsk}>
            Marcar como paga
          </button>
        </div>
      ) : null}
      {confirming ? (
        <ConfirmBar
          message={`Marcar ${name} como paga?`}
          confirmLabel="Sim, marcar como paga"
          busy={pay.isPending}
          error={error}
          retryable={status === 0 || status >= 500}
          hint={status === 422 ? "Lance o pagamento pelo chat, informando a conta usada." : null}
          onConfirm={() => pay.mutate(bill)}
          onCancel={onClose}
        />
      ) : null}
    </li>
  );
}
