import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";

/** Voltar ao app depois de `limitMs` fora pede o login de novo (só quando a chave de acesso é exigida). */
export function useAwayLogout(enabled: boolean, limitMs = 5 * 60_000) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const here = useRef(pathname + search);
  useEffect(() => {
    here.current = pathname + search;
  }, [pathname, search]);

  useEffect(() => {
    if (!enabled) return;
    let hiddenAt: number | null = null;
    const onChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const left = hiddenAt;
      hiddenAt = null;
      if (left !== null && Date.now() - left > limitMs) {
        const next = encodeURIComponent(here.current);
        void logout().finally(() => void navigate(`/login?next=${next}`, { replace: true }));
      }
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, [enabled, limitMs, logout, navigate]);
}
