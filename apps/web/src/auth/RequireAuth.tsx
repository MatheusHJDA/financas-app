import { Navigate, Outlet, useLocation } from "react-router-dom";
import { ErrorState, LoadingState } from "../ui/States";
import { useAuth } from "./AuthProvider";

/** Guard das rotas protegidas: sem sessão (inclusive após 401) vai para /login e volta ao destino depois. */
export function RequireAuth() {
  const { me, isError, retry } = useAuth();
  const { pathname, search } = useLocation();
  if (isError) return <ErrorState message="Não foi possível falar com o servidor." onRetry={retry} />;
  if (me === undefined) return <LoadingState />;
  if (me === null) {
    const here = pathname + search;
    return <Navigate to={here === "/" ? "/login" : `/login?next=${encodeURIComponent(here)}`} replace />;
  }
  return <Outlet />;
}
