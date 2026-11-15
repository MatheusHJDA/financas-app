import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Check } from "lucide-react";
import { useId, useState } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { Avatar, Button, Card, EmptyState, ListItem, Money, Sheet } from "../../ui";
import { ConfirmBar } from "../accounts/ConfirmBar";
import { ApiError, OWNER_LABEL, assertOk, canWrite, errorMessage, type BillInstance } from "../accounts/shared";
import { formatDate } from "../chat/dates";
import { AFTER_PAID } from "./api";
import { dueBadge, type DueBadge } from "./dueStatus";
import "../accounts/ui.css";
import "./bills.css";

interface Props {
  upcoming: BillInstance[];
  overdue: BillInstance[];
}

/** Contas a pagar (vencidas e próximos 15 dias) com selo de vencimento. Só grava depois da confirmação. */
export function PayableBills({ upcoming, overdue }: Props) {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<BillInstance | null>(null);
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
      await Promise.all(AFTER_PAID.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
    },
    onError: (error) => {
      // 409 ("já foi paga") e afins: a lista está velha, atualize.
      if (error instanceof ApiError && error.status === 409) void queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  const ask = (bill: BillInstance) => {
    pay.reset();
    setNotice("");
    setConfirming(bill);
  };
  const close = () => {
    pay.reset();
    setConfirming(null);
  };

  const row = (bill: BillInstance, late: boolean) => (
    <PayableRow
      key={bill.id}
      bill={bill}
      late={late}
      editable={bill.owner == null ? true : canWrite(me, bill.owner)}
      onAsk={() => ask(bill)}
    />
  );

  const name = confirming?.name ?? "Conta";
  const status = pay.isError && pay.error instanceof ApiError ? pay.error.status : 0;

  return (
    <>
      <Card title="Contas a pagar" icon={CalendarClock}>
        <p className="u8-sr" role="status" aria-live="polite">
          {notice}
        </p>
        {overdue.length === 0 && upcoming.length === 0 ? (
          <EmptyState title="Nenhuma conta a pagar" hint="Nada vencido e nada nos próximos 15 dias." />
        ) : null}
        {overdue.length > 0 ? (
          <div role="group" aria-label="Contas vencidas" className="bill-group">
            <h3 className="bill-group__title">Vencidas</h3>
            <ul className="bill-list">{overdue.map((b) => row(b, true))}</ul>
          </div>
        ) : null}
        {upcoming.length > 0 ? (
          <div role="group" aria-label="Próximos 15 dias" className="bill-group">
            <h3 className="bill-group__title">Próximos 15 dias</h3>
            <ul className="bill-list">{upcoming.map((b) => row(b, false))}</ul>
          </div>
        ) : null}
      </Card>

      <Sheet open={confirming !== null} title="Marcar como paga" onClose={close}>
        <ConfirmBar
          message={`Marcar ${name} como paga?`}
          confirmLabel="Sim, marcar como paga"
          busy={pay.isPending}
          error={pay.isError ? errorMessage(pay.error, "Você não pode pagar essa conta.") : null}
          retryable={status === 0 || status >= 500}
          hint={status === 422 ? "Lance o pagamento pelo chat, informando a conta usada." : null}
          onConfirm={() => confirming && pay.mutate(confirming)}
          onCancel={close}
        />
      </Sheet>
    </>
  );
}

function badgeFor(bill: BillInstance, late: boolean): DueBadge | null {
  const badge = dueBadge(bill.due_date);
  // A API já separou as vencidas: se a lista diz "vencida", o selo diz "Atrasada" mesmo com o relógio fora.
  if (late && badge?.tone !== "late") return { label: "Atrasada", tone: "late" };
  return badge;
}

function PayableRow({
  bill,
  late,
  editable,
  onAsk,
}: {
  bill: BillInstance;
  late: boolean;
  editable: boolean;
  onAsk: () => void;
}) {
  const nameId = useId();
  const name = bill.name ?? "Conta";
  const badge = badgeFor(bill, late);
  return (
    <li className="bill-pay">
      <ListItem
        leading={<Avatar name={name} tone={badge?.tone === "late" ? "expense" : "warning"} />}
        title={<span id={nameId}>{name}</span>}
        subtitle={
          <span className="bill-sub">
            <span>
              {bill.owner ? `${OWNER_LABEL[bill.owner]} · ` : ""}
              vence em {formatDate(bill.due_date)}
            </span>
            {badge ? <span className={`bill-badge bill-badge--${badge.tone}`}>{badge.label}</span> : null}
          </span>
        }
        trailing={<Money cents={bill.amount_cents} />}
      />
      {editable ? (
        <Button variant="secondary" icon={Check} aria-describedby={nameId} onClick={onAsk}>
          Marcar como paga
        </Button>
      ) : null}
    </li>
  );
}
