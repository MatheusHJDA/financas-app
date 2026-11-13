import { lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AdminRoute } from "../auth/AdminRoute";
import { AuthProvider } from "../auth/AuthProvider";
import { LoginPage } from "../auth/LoginPage";
import { RequireAuth } from "../auth/RequireAuth";
import { Shell } from "../shell/Shell";

const ChatTab = lazy(() => import("../shell/tabs/ChatTab"));
const GeralTab = lazy(() => import("../shell/tabs/GeralTab"));
const MetasTab = lazy(() => import("../shell/tabs/MetasTab"));
const PlanoTab = lazy(() => import("../shell/tabs/PlanoTab"));
const MaisTab = lazy(() => import("../shell/tabs/MaisTab"));
const AdminPage = lazy(() => import("../features/admin/AdminPage"));

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<Shell />}>
            <Route index element={<ChatTab />} />
            <Route path="geral" element={<GeralTab />} />
            <Route path="metas" element={<MetasTab />} />
            <Route path="plano" element={<PlanoTab />} />
            <Route path="mais" element={<MaisTab />} />
            <Route element={<AdminRoute />}>
              <Route path="mais/admin" element={<AdminPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
