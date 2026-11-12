import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { api, onUnauthorized } from "../api/client";
import type { components } from "../api/schema";

export type Me = components["schemas"]["Me"];

interface AuthValue {
  me: Me | null | undefined; // undefined = carregando
  isError: boolean;
  retry: () => void;
  setMe: (me: Me | null) => void;
  logout: () => Promise<void>;
}

const ME_KEY = ["me"] as const;
const AuthContext = createContext<AuthValue | null>(null);

async function fetchMe(): Promise<Me | null> {
  const { data, response } = await api.GET("/auth/me");
  if (response.status === 401) return null;
  if (!data) throw new Error(`HTTP ${response.status}`);
  return data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ME_KEY, queryFn: fetchMe, retry: false, staleTime: Infinity });

  const setMe = useCallback(
    (me: Me | null) => {
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] });
      queryClient.setQueryData(ME_KEY, me);
    },
    [queryClient],
  );

  // Qualquer 401 fora do login derruba a sessão local; o guard redireciona para /login.
  useEffect(() => {
    onUnauthorized(() => setMe(null));
    return () => onUnauthorized(null);
  }, [setMe]);

  const logout = useCallback(async () => {
    try {
      await api.POST("/auth/logout");
    } finally {
      setMe(null);
    }
  }, [setMe]);

  const value = useMemo<AuthValue>(
    () => ({
      me: query.data,
      isError: query.isError,
      retry: () => void query.refetch(),
      setMe,
      logout,
    }),
    [query, setMe, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fora do AuthProvider");
  return ctx;
}
