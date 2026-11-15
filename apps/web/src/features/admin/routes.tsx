import { Navigate, useParams } from "react-router-dom";
import { ADMIN_SECTIONS, type AdminSlug } from "../../shell/nav";
import "./admin.css";
import { AiSection } from "./AiSection";
import { AuditSection } from "./AuditSection";
import { NotificationsSection } from "./NotificationsSection";
import { SettingsSection } from "./SettingsSection";
import { SystemSection } from "./SystemSection";
import { UsersSection } from "./UsersSection";

const VIEWS: Record<AdminSlug, () => JSX.Element> = {
  usuarios: UsersSection,
  configuracoes: SettingsSection,
  avisos: NotificationsSection,
  ia: AiSection,
  auditoria: AuditSection,
  sistema: SystemSection,
};

// Uma página por seção (/admin/:secao); o menu (celular e lateral) é quem troca de seção.
// A guarda de admin fica em AdminRoute (App.tsx): aqui só se renderiza.
export default function AdminSectionPage() {
  const { secao } = useParams();
  const meta = ADMIN_SECTIONS.find((s) => s.slug === secao);
  if (!meta) return <Navigate to="/admin/usuarios" replace />;
  const View = VIEWS[meta.slug];
  return (
    <section className="screen admin">
      <h1>{meta.label}</h1>
      <div id={`admin-${meta.slug}`} className="admin-body">
        <View />
      </div>
    </section>
  );
}
