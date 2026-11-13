import { useState } from "react";
import "./admin.css";
import { AiSection } from "./AiSection";
import { AuditSection } from "./AuditSection";
import { NotificationsSection } from "./NotificationsSection";
import { SettingsSection } from "./SettingsSection";
import { SystemSection } from "./SystemSection";
import { UsersSection } from "./UsersSection";

const SECTIONS = [
  { id: "usuarios", label: "Usuários", View: UsersSection },
  { id: "configuracoes", label: "Configurações", View: SettingsSection },
  { id: "notificacoes", label: "Notificações", View: NotificationsSection },
  { id: "ia", label: "IA", View: AiSection },
  { id: "auditoria", label: "Auditoria", View: AuditSection },
  { id: "sistema", label: "Sistema", View: SystemSection },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

// Dono: U9. Painel admin (só Matheus). A rota /mais/admin já exige role "admin" (AdminRoute).
export default function AdminPage() {
  const [current, setCurrent] = useState<SectionId>("usuarios");
  const active = SECTIONS.find((s) => s.id === current) ?? SECTIONS[0];

  return (
    <section className="screen admin">
      <h1>Painel admin</h1>
      <nav aria-label="Seções do painel" className="admin-nav">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="btn"
            aria-current={s.id === current ? "true" : undefined}
            onClick={() => setCurrent(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <div id={`admin-${active.id}`}>
        <active.View />
      </div>
    </section>
  );
}
