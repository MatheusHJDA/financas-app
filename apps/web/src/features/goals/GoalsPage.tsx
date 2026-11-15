import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { Button, EmptyState, ErrorState, Skeleton, SkeletonGroup } from "../../ui";
import { useAllAccounts, useAllCategories } from "../accounts/queries";
import { assertOk, errorMessage } from "../accounts/shared";
import { emptyGoalForm, type GoalBody } from "./goalForm";
import { GoalCard } from "./GoalCard";
import { GoalForm } from "./GoalFormFields";
import "./goals.css";

async function loadGoals() {
  const { data, response } = await api.GET("/goals", { params: { query: { limit: 200 } } });
  if (!data) throw new Error(`HTTP ${response.status}`);
  return data.items;
}

/** Esqueleto com a forma da lista: cartões com bolha, título, barra e valor. */
function GoalsSkeleton() {
  return (
    <SkeletonGroup label="Carregando metas…">
      <div className="goal-skeleton">
        {[0, 1, 2].map((i) => (
          <div key={i} className="goal-card">
            <div className="goal-card__top">
              <Skeleton variant="circle" />
              <div className="goal-card__titles" style={{ display: "grid", gap: 6 }}>
                <Skeleton width="55%" />
                <Skeleton width="35%" />
              </div>
            </div>
            <Skeleton height="10px" />
            <Skeleton width="45%" />
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}

// Dono: U8/U20. Tela de Metas: progresso, criar/editar/excluir as próprias e aportes manuais.
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
  const open = () => {
    create.reset();
    setNotice("");
    setCreating(true);
  };

  return (
    <section className="goal-page">
      <div className="goal-head">
        <h1>Metas</h1>
        {goals.data && !creating ? (
          <Button variant="primary" icon={Plus} onClick={open}>
            Nova meta
          </Button>
        ) : null}
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">
        {notice}
      </p>

      {goals.data && creating ? (
        <div className="goal-formcard">
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
      ) : null}

      {goals.isLoading ? <GoalsSkeleton /> : null}
      {goals.isError ? <ErrorState message="Não foi possível carregar as metas." onRetry={() => void goals.refetch()} /> : null}

      {goals.data && goals.data.length === 0 && !creating ? (
        <EmptyState title="Nenhuma meta ainda" hint="Crie uma meta para acompanhar o progresso." />
      ) : null}

      {goals.data && goals.data.length > 0 ? (
        <ul className="goal-list" aria-label="Metas">
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
    </section>
  );
}
