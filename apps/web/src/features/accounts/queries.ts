import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { Account, Category } from "./shared";

// Prefixos de chave combinados com o plano: ["accounts"], ["transactions"], ["overview"],
// ["bill-instances"], ["goals"]. Depois de gravar, invalide o prefixo.
export const ACCOUNTS_ALL_KEY = ["accounts", "all"] as const;
export const CATEGORIES_ALL_KEY = ["categories", "all"] as const;

async function loadAccounts(): Promise<Account[]> {
  const { data, response } = await api.GET("/accounts", { params: { query: { limit: 200 } } });
  if (!data) throw new Error(`HTTP ${response.status}`);
  return data.items;
}

async function loadCategories(): Promise<Category[]> {
  const { data, response } = await api.GET("/categories", { params: { query: { limit: 200 } } });
  if (!data) throw new Error(`HTTP ${response.status}`);
  return data.items;
}

/** Todas as contas (ativas e inativas). */
export function useAllAccounts() {
  return useQuery({ queryKey: ACCOUNTS_ALL_KEY, queryFn: loadAccounts, staleTime: 30_000 });
}

export function useAllCategories() {
  return useQuery({ queryKey: CATEGORIES_ALL_KEY, queryFn: loadCategories, staleTime: 5 * 60_000 });
}
