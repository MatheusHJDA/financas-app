import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { detectPlatform } from "../../auth/deviceLabel";
import { NotificationsCard } from "../../features/notifications/NotificationsCard";

export default function MaisTab() {
  const { me, logout } = useAuth();
  const [leaving, setLeaving] = useState(false);
  const platform = detectPlatform();

  return (
    <section className="screen">
      <h1>Mais</h1>
      {me ? <p className="muted">Conectado como {me.name}</p> : null}

      <NotificationsCard />

      {me?.role === "admin" ? (
        <Link to="/mais/admin" className="btn">
          Painel admin
        </Link>
      ) : null}

      <section aria-labelledby="install-title" className="card">
        <h2 id="install-title">Como instalar no celular</h2>
        <div className={platform === "iphone" ? "install install--mine" : "install"}>
          <h3>iPhone</h3>
          <p>Safari → Compartilhar → Adicionar à Tela de Início.</p>
        </div>
        <div className={platform === "android" ? "install install--mine" : "install"}>
          <h3>Android</h3>
          <p>Chrome → menu → Instalar app.</p>
        </div>
      </section>

      <button
        type="button"
        className="btn btn--danger"
        disabled={leaving}
        onClick={() => {
          setLeaving(true);
          void logout().finally(() => setLeaving(false));
        }}
      >
        Sair
      </button>
    </section>
  );
}
