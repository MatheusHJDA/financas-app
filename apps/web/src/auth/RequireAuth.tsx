import { Navigate, Outlet } from "react-router-dom";
import { ErrorState, LoadingState } from "../ui/States";
import { useAuth } from "./AuthProvider";

/** Guard das rotas protegidas: sem sessão (inclusive após 401) vai para /login. */
export function RequireAuth() {
  const { me, isError, retry } = useAuth();
  if (isError) return <ErrorState message="Não foi possível falar com o servidor." onRetry={retry} />;
  if (me === undefined) return <LoadingState />;
  if (me === null) return <Navigate to="/login" replace />;
  return <Outlet />;
}
