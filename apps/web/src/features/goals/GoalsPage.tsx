import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { EmptyState, ErrorState, LoadingState } from "../../ui/States";
import { useAllAccounts, useAllCategories } from "../accounts/queries";
import { assertOk, errorMessage } from "../accounts/shared";
import { emptyGoalForm, type GoalBody } from "./goalForm";
import { GoalCard } from "./GoalCard";
import { GoalForm } from "./GoalFormFields";
import "../accounts/ui.css";

async function loadGoals() {
  const { data, response } = await api.GET("/goals", { params: { query: { limit: 200 } } });
  if (!data) throw new Error(`HTTP ${response.status}`);
  return data.items;
}

// Dono: U8. Tela de Metas: progresso, criar/editar/excluir as próprias e aportes manuais.
export default function GoalsPage() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const goals = useQuery({ queryKey: ["goals", "list"], queryFn: loadGoals });
  const accounts = useAllAccounts();
  const categories = useAllCategories();
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");

  const create = useMutation({
    mutationFn: async (body: GoalBody) => {
      const { response, error } = await api.POST("/goals", { body });
      assertOk(response, error);
    },
    onSuccess: async () => {
      setCreating(false);
      setNotice("Meta criada.");
      await queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
  });

  const close = () => {
    create.reset();
    setCreating(false);
  };

  return (
    <section className="u8-page">
      <h1>Metas</h1>
      <p className="u8-sr" role="status" aria-live="polite">
        {notice}
      </p>

      {goals.isLoading ? <LoadingState label="Carregando metas…" /> : null}
      {goals.isError ? <ErrorState message="Não foi possível carregar as metas." onRetry={() => void goals.refetch()} /> : null}

      {goals.data && goals.data.length === 0 && !creating ? (
        <EmptyState title="Nenhuma meta ainda" hint="Crie uma meta para acompanhar o progresso." />
      ) : null}

      {goals.data && goals.data.length > 0 ? (
        <ul className="u8-list" aria-label="Metas">
          {goals.data.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              accounts={accounts.data ?? []}
              categories={categories.data ?? []}
              onNotice={setNotice}
            />
          ))}
        </ul>
      ) : null}

      {goals.data ? (
        creating ? (
          <div className="u8-card">
            <h2>Nova meta</h2>
            <GoalForm
              initial={emptyGoalForm(me?.owner ?? "AMBOS")}
              accounts={accounts.data ?? []}
              categories={categories.data ?? []}
              submitLabel="Criar meta"
              busy={create.isPending}
              serverError={create.isError ? errorMessage(create.error, "Você não pode criar meta para esse dono.") : null}
              onSubmit={(body) => create.mutate(body)}
              onCancel={close}
            />
          </div>
        ) : (
          <div className="u8-actions">
            <button
              type="button"
              className="u8-btn u8-btn--primary"
              onClick={() => {
                create.reset();
                setNotice("");
                setCreating(true);
              }}
            >
              Nova meta
            </button>
          </div>
        )
      ) : null}
    </section>
  );
}
