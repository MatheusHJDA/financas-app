import { Bell, Eye, EyeOff } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useHideValues } from "../ui";
import { titleFor } from "./nav";

/** Cabeçalho do computador: trilha, olho de ocultar valores e sino (contas a pagar). */
export function Header() {
  const { pathname } = useLocation();
  const { hidden, toggle } = useHideValues();
  const title = titleFor(pathname);
  return (
    <header className="topbar">
      <p className="topbar__crumb">
        <span className="muted">Finanças</span>
        {title ? (
          <>
            <span className="muted" aria-hidden="true">
              {" / "}
            </span>
            <span>{title}</span>
          </>
        ) : null}
      </p>
      <div className="topbar__actions">
        <button
          type="button"
          className="ui-icon-btn"
          aria-label={hidden ? "Mostrar valores" : "Ocultar valores"}
          title={hidden ? "Mostrar valores" : "Ocultar valores"}
          onClick={toggle}
        >
          {hidden ? <Eye aria-hidden="true" size={20} /> : <EyeOff aria-hidden="true" size={20} />}
        </button>
        <Link to="/contas-fixas" className="ui-icon-btn" aria-label="Contas a pagar" title="Contas a pagar">
          <Bell aria-hidden="true" size={20} strokeWidth={1.75} />
        </Link>
      </div>
    </header>
  );
}
