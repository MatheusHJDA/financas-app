import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthProvider";

/** Rotas só do admin: quem não é admin volta para a aba Mais (a API também devolve 403). */
export function AdminRoute() {
  const { me } = useAuth();
  if (me?.role !== "admin") return <Navigate to="/mais" replace />;
  return <Outlet />;
}
