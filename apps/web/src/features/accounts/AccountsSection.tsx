import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { formatCents } from "../chat/money";
import { LoadingState, ErrorState, EmptyState } from "../../ui/States";
import { AccountForm } from "./AccountFormFields";
import { accountToForm, emptyAccountForm, type AccountBody } from "./accountForm";
import { useAllAccounts } from "./queries";
import { ACCOUNT_TYPE_LABEL, OWNER_LABEL, assertOk, canWrite, errorMessage, type Account } from "./shared";
import "./ui.css";

type Editing = { kind: "new" } | { kind: "edit"; account: Account } | null;

/** Cadastro e edição das contas que o usuário pode alterar (próprias, do casal ou todas, se admin). */
export function AccountsSection() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const accounts = useAllAccounts();
  const [editing, setEditing] = useState<Editing>(null);
  const [notice, setNotice] = useState("");

  const save = useMutation({
    mutationFn: async (input: { id: number | null; body: AccountBody }) => {
      if (input.id === null) {
        const { response, error } = await api.POST("/accounts", { body: input.body });
        assertOk(response, error);
      } else {
        const { response, error } = await api.PATCH("/accounts/{id}", {
          params: { path: { id: input.id } },
          body: input.body,
        });
        assertOk(response, error);
      }
    },
    onSuccess: async (_data, input) => {
      setEditing(null);
      setNotice(input.id === null ? "Conta criada." : "Conta atualizada.");
      await Promise.all(
        ["accounts", "overview", "goals"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
      );
    },
  });

  const mine = (accounts.data ?? []).filter((a) => canWrite(me, a.owner));
  const close = () => {
    setEditing(null);
    save.reset();
  };

  return (
    <section className="u8-section" aria-labelledby="accounts-title">
      <h2 id="accounts-title">Minhas contas</h2>
      <p className="u8-sr" role="status" aria-live="polite">
        {notice}
      </p>

      {accounts.isLoading ? <LoadingState label="Carregando contas…" /> : null}
      {accounts.isError ? <ErrorState message="Não foi possível carregar as contas." onRetry={() => void accounts.refetch()} /> : null}

      {accounts.data ? (
        <>
          {mine.length === 0 && !editing ? (
            <EmptyState title="Nenhuma conta ainda" hint="Cadastre a primeira conta para começar a lançar." />
          ) : (
            <ul className="u8-list">
              {mine.map((a) => (
                <li key={a.id} className="u8-card">
                  <div className="u8-row">
                    <div className="u8-grow">
                      <strong>{a.name}</strong>
                      <p className="muted u8-small" style={{ margin: 0 }}>
                        {ACCOUNT_TYPE_LABEL[a.type]} · {OWNER_LABEL[a.owner]}
                        {a.active ? "" : " · inativa"}
                      </p>
                    </div>
                    <span className={`u8-amount ${a.current_balance_cents < 0 ? "u8-neg" : ""}`}>
                      {formatCents(a.current_balance_cents)}
                    </span>
                  </div>
                  {editing?.kind === "edit" && editing.account.id === a.id ? (
                    <AccountForm
                      key={a.id}
                      editing
                      initial={accountToForm(a)}
                      submitLabel="Salvar conta"
                      busy={save.isPending}
                      serverError={save.isError ? errorMessage(save.error, "Você não pode alterar essa conta.") : null}
                      onSubmit={(body) => save.mutate({ id: a.id, body })}
                      onCancel={close}
                    />
                  ) : (
                    <div className="u8-actions" style={{ marginTop: "var(--space-2)" }}>
                      <button
                        type="button"
                        className="u8-btn"
                        aria-label={`Editar conta ${a.name}`}
                        onClick={() => {
                          save.reset();
                          setNotice("");
                          setEditing({ kind: "edit", account: a });
                        }}
                      >
                        Editar
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {editing?.kind === "new" ? (
            <div className="u8-card" style={{ marginTop: "var(--space-3)" }}>
              <h3>Nova conta</h3>
              <AccountForm
                initial={emptyAccountForm(me?.owner ?? "AMBOS")}
                submitLabel="Criar conta"
                busy={save.isPending}
                serverError={save.isError ? errorMessage(save.error, "Você não pode criar conta para esse dono.") : null}
                onSubmit={(body) => save.mutate({ id: null, body })}
                onCancel={close}
              />
            </div>
          ) : (
            <div className="u8-actions" style={{ marginTop: "var(--space-3)" }}>
              <button
                type="button"
                className="u8-btn u8-btn--primary"
                onClick={() => {
                  save.reset();
                  setNotice("");
                  setEditing({ kind: "new" });
                }}
              >
                Nova conta
              </button>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
