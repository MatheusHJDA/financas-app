import { lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AdminRoute } from "../auth/AdminRoute";
import { AuthProvider } from "../auth/AuthProvider";
import { LoginPage } from "../auth/LoginPage";
import { RequireAuth } from "../auth/RequireAuth";
import { Shell } from "../shell/Shell";
import { HideValuesProvider } from "../ui";

// Rotas do redesenho (plano 2026-11-14, "Rotas"). Rotas antigas redirecionam.
const DashboardPage = lazy(() => import("../features/dashboard/DashboardPage"));
const TransactionsPage = lazy(() => import("../features/transactions/TransactionsPage"));
const ChatPage = lazy(() => import("../features/chat/ChatPage"));
const ReportsPage = lazy(() => import("../features/reports/ReportsPage"));
const MorePage = lazy(() => import("../features/settings/MorePage"));
const PreferencesPage = lazy(() => import("../features/settings/PreferencesPage"));
const FixedBillsPage = lazy(() => import("../features/bills/FixedBillsPage"));
const AccountsPage = lazy(() => import("../features/accounts/AccountsPage"));
const GoalsPage = lazy(() => import("../features/goals/GoalsPage"));
const CategoriesPage = lazy(() => import("../features/categories/CategoriesPage"));
const LoanPage = lazy(() => import("../features/debts/LoanPage"));
const DebtsRedirect = lazy(() => import("../features/debts/LoanPage").then((m) => ({ default: m.DebtsRedirect })));
const PlanPage = lazy(() => import("../features/plan/PlanPage"));
const AdminSectionPage = lazy(() => import("../features/admin/routes"));
const KitPage = import.meta.env.DEV ? lazy(() => import("../dev/KitPage")) : null;

export default function App() {
  return (
    <AuthProvider>
      <HideValuesProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<Shell />}>
              <Route index element={<DashboardPage />} />
              <Route path="transacoes" element={<TransactionsPage />} />
              <Route path="lancar" element={<ChatPage />} />
              <Route path="relatorios" element={<ReportsPage />} />
              <Route path="mais" element={<MorePage />} />
              <Route path="preferencias" element={<PreferencesPage />} />
              <Route path="contas-fixas" element={<FixedBillsPage />} />
              <Route path="contas" element={<AccountsPage />} />
              <Route path="metas" element={<GoalsPage />} />
              <Route path="categorias" element={<CategoriesPage />} />
              <Route path="dividas" element={<DebtsRedirect />} />
              <Route path="dividas/:id" element={<LoanPage />} />
              <Route path="plano" element={<PlanPage />} />
              <Route path="geral" element={<Navigate to="/" replace />} />
              <Route element={<AdminRoute />}>
                <Route path="admin" element={<Navigate to="/admin/usuarios" replace />} />
                <Route path="admin/:secao" element={<AdminSectionPage />} />
                <Route path="mais/admin" element={<Navigate to="/admin/usuarios" replace />} />
              </Route>
              {KitPage ? <Route path="dev/kit" element={<KitPage />} /> : null}
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HideValuesProvider>
    </AuthProvider>
  );
}
