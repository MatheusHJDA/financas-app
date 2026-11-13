import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { Account, Category } from "./types";

// Chaves próprias (prefixo "accounts"/"categories" para entrar nas invalidações em lote).
export const ACCOUNTS_KEY = ["accounts", "chat-options"] as const;
export const CATEGORIES_KEY = ["categories", "chat-options"] as const;

async function loadAccounts(): Promise<Account[]> {
  const { data, response } = await api.GET("/accounts", { params: { query: { limit: 200 } } });
  if (!data) throw new Error(`HTTP ${response.status}`);
  return data.items.filter((a) => a.active);
}

async function loadCategories(): Promise<Category[]> {
  const { data, response } = await api.GET("/categories", { params: { query: { limit: 200 } } });
  if (!data) throw new Error(`HTTP ${response.status}`);
  return data.items;
}

/** Contas ativas e categorias, para cartões e formulários. */
export function useChatData() {
  const accounts = useQuery({ queryKey: ACCOUNTS_KEY, queryFn: loadAccounts, staleTime: 60_000 });
  const categories = useQuery({ queryKey: CATEGORIES_KEY, queryFn: loadCategories, staleTime: 5 * 60_000 });
  return {
    accounts: accounts.data ?? [],
    categories: categories.data ?? [],
    isLoading: accounts.isLoading || categories.isLoading,
    isError: accounts.isError || categories.isError,
    retry: () => {
      void accounts.refetch();
      void categories.refetch();
    },
  };
}
