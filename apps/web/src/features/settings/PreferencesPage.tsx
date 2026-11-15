import { Monitor, Moon, Palette, Smartphone, Sun, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { detectPlatform } from "../../auth/deviceLabel";
import { Card } from "../../ui";
import { NotificationsCard } from "../notifications/NotificationsCard";
import "./settings.css";
import { applyTheme, readTheme, saveTheme, type ThemeChoice } from "./theme";

const THEME_OPTIONS: { value: ThemeChoice; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Escuro", icon: Moon },
  { value: "auto", label: "Automático", icon: Monitor },
];

// Seletor segmentado local (o kit não tem): três rádios nativos, teclado e leitor de tela de graça.
function ThemeCard() {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  const pick = (next: ThemeChoice) => {
    setChoice(next);
    applyTheme(next);
    saveTheme(next);
  };
  return (
    <Card title="Aparência" icon={Palette}>
      <div role="radiogroup" aria-label="Tema" className="pref-seg">
        {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
          <label key={value} className="pref-seg__opt">
            <input
              type="radio"
              name="theme"
              className="pref-seg__input"
              checked={choice === value}
              onChange={() => pick(value)}
            />
            <span className="pref-seg__face">
              <Icon aria-hidden="true" size={18} strokeWidth={1.75} />
              {label}
            </span>
          </label>
        ))}
      </div>
      <p className="muted pref-hint">Automático segue o claro/escuro do aparelho. A escolha fica neste aparelho.</p>
    </Card>
  );
}

// Preferências: notificações deste aparelho, tema e como instalar.
export default function PreferencesPage() {
  const platform = detectPlatform();
  return (
    <section className="screen">
      <h1>Preferências</h1>
      <NotificationsCard />
      <ThemeCard />
      <Card title="Como instalar no celular" icon={Smartphone}>
        <div className={platform === "iphone" ? "install install--mine" : "install"}>
          <h3>iPhone</h3>
          <p>Safari → Compartilhar → Adicionar à Tela de Início.</p>
        </div>
        <div className={platform === "android" ? "install install--mine" : "install"}>
          <h3>Android</h3>
          <p>Chrome → menu → Instalar app.</p>
        </div>
      </Card>
    </section>
  );
}
