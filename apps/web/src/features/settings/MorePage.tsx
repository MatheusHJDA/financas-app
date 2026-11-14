import { ChevronRight, LogOut } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { MORE_ITEMS } from "../../shell/nav";
import { Button, Card } from "../../ui";
import "./settings.css";

// Tela Mais (celular): atalhos com ícone para o que não cabe na barra. Restilização final: U23.
export default function MorePage() {
  const { me, logout } = useAuth();
  const [leaving, setLeaving] = useState(false);
  const isAdmin = me?.role === "admin";

  return (
    <section className="screen">
      <h1>Mais</h1>
      {me ? <p className="muted">Conectado como {me.name}</p> : null}
      <Card>
        <ul className="more-list">
          {MORE_ITEMS.filter((i) => !i.adminOnly || isAdmin).map((i) => (
            <li key={i.to}>
              <Link to={i.to} className="more-link">
                <span className="more-link__icon" aria-hidden="true">
                  <i.icon size={20} strokeWidth={1.75} />
                </span>
                <span className="more-link__label">{i.label}</span>
                <ChevronRight aria-hidden="true" size={18} className="muted" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <Button
        variant="danger"
        icon={LogOut}
        block
        disabled={leaving}
        onClick={() => {
          setLeaving(true);
          void logout().finally(() => setLeaving(false));
        }}
      >
        Sair
      </Button>
    </section>
  );
}
