import { detectPlatform } from "../../auth/deviceLabel";
import { NotificationsCard } from "../notifications/NotificationsCard";
import "./settings.css";

// Preferências: notificações deste aparelho e como instalar. Tema claro/escuro chega na U23.
export default function PreferencesPage() {
  const platform = detectPlatform();
  return (
    <section className="screen">
      <h1>Preferências</h1>
      <NotificationsCard />
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
    </section>
  );
}
