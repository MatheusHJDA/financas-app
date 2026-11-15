import { CheckCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "../../ui";
import { DraftCard } from "./DraftCard";
import { missingForConfirm } from "./proposal";
import type { Account, Category, IngestResult, Owner } from "./types";
import type { ConfirmItem, useDraftController } from "./useDraftController";

type Controller = ReturnType<typeof useDraftController>;

interface Props {
  result: IngestResult;
  controller: Controller;
  accounts: Account[];
  categories: Category[];
  fallbackOwner: Owner;
}

/** Resposta da IA: avisos, cartões e (com 2+ pendentes) "Confirmar todos" com segunda confirmação. */
export function ResultGroup({ result, controller, accounts, categories, fallbackOwner }: Props) {
  const { views, confirmOne, confirmMany, discard, payBill, setEdited } = controller;
  const [asking, setAsking] = useState(false);

  const pendingItems: ConfirmItem[] = result.drafts
    .filter((d) => (views[d.id]?.status ?? d.status) === "pending")
    .map((d) => ({ draft: d, edited: views[d.id]?.edited ?? null }));
  const ready = pendingItems.filter((i) => missingForConfirm(i.edited ?? i.draft.payload) === null);
  const anyBusy = pendingItems.some((i) => views[i.draft.id]?.busy);

  return (
    <div className="result">
      {result.warnings.length > 0 ? (
        <ul className="warnings" aria-label="Avisos da leitura">
          {result.warnings.map((w, i) => (
            <li key={i} className="chat-signal chat-signal--warn">
              {w}
            </li>
          ))}
        </ul>
      ) : null}

      {result.drafts.length === 0 ? (
        <p className="chat-signal">Não encontrei nenhum lançamento nesse envio. Tente outra foto ou escreva os dados.</p>
      ) : null}

      {result.drafts.map((d) => {
        const view = views[d.id];
        if (!view) return null;
        return (
          <DraftCard
            key={d.id}
            draft={d}
            view={view}
            accounts={accounts}
            categories={categories}
            fallbackOwner={fallbackOwner}
            onConfirm={(item) => void confirmOne(item)}
            onDiscard={(draft) => void discard(draft)}
            onEdit={setEdited}
            onPayBill={(...args) => void payBill(...args)}
          />
        );
      })}

      {pendingItems.length >= 2 ? (
        <div className="batch">
          {asking ? (
            <div role="group" aria-label="Confirmar todos">
              <p>
                <strong>
                  Confirmar {ready.length} {ready.length === 1 ? "lançamento" : "lançamentos"}?
                </strong>
              </p>
              <div className="draft-actions">
                <Button
                  variant="primary"
                  disabled={anyBusy || ready.length === 0}
                  onClick={() => {
                    setAsking(false);
                    void confirmMany(ready);
                  }}
                >
                  Sim, confirmar
                </Button>
                <Button onClick={() => setAsking(false)}>Voltar</Button>
              </div>
            </div>
          ) : (
            <Button icon={CheckCheck} block disabled={anyBusy || ready.length === 0} onClick={() => setAsking(true)}>
              Confirmar todos
            </Button>
          )}
          {ready.length < pendingItems.length ? (
            <p className="muted">
              {pendingItems.length - ready.length} sem conta definida ficam de fora até você editar.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
