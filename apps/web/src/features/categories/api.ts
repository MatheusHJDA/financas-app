import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { assertOk } from "../accounts/shared";

export type CategoryKind = "income" | "expense";

/** Nome da categoria aparece em lançamentos, contas fixas, metas, chat e relatórios: tudo é relido. */
export const AFTER_CATEGORY_CHANGED = ["categories", "transactions", "recurring-bills", "bill-instances", "goals", "report"];

/** Limite do servidor (categories/router.py: max_length=120). */
export const NAME_MAX = 120;

export function useCategoryMutations() {
  const queryClient = useQueryClient();
  const refresh = () => Promise.all(AFTER_CATEGORY_CHANGED.map((k) => queryClient.invalidateQueries({ queryKey: [k] })));

  const create = useMutation({
    mutationFn: async (body: { name: string; kind: CategoryKind }) => {
      const { response, error } = await api.POST("/categories", { body: { ...body, is_recurring_card_allowed: false } });
      assertOk(response, error);
    },
    onSuccess: refresh,
  });
  const rename = useMutation({
    mutationFn: async (v: { id: number; name: string }) => {
      const { response, error } = await api.PATCH("/categories/{id}", {
        params: { path: { id: v.id } },
        body: { name: v.name },
      });
      assertOk(response, error);
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (id: number) => {
      const { response, error } = await api.DELETE("/categories/{id}", { params: { path: { id } } });
      assertOk(response, error);
    },
    onSuccess: refresh,
  });
  return { create, rename, remove };
}
