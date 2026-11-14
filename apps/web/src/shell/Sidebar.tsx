import { LogOut, SlidersHorizontal } from "lucide-react";
import { useId, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Avatar, SparkleIcon } from "../ui";
import { SIDEBAR_GROUPS } from "./nav";

/** Menu lateral do computador (≥ 1024px). Administração só para admin. */
export function Sidebar() {
  const { me, logout } = useAuth();
  const [leaving, setLeaving] = useState(false);
  const isAdmin = me?.role === "admin";
  const baseId = useId();

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <SparkleIcon size={26} />
        <span>Finanças</span>
      </div>
      <nav aria-label="Menu lateral" className="sidebar__nav">
        {SIDEBAR_GROUPS.filter((g) => !g.adminOnly || isAdmin).map((g, i) => (
          <div key={g.label} className="sidebar__group" role="group" aria-labelledby={`${baseId}-${i}`}>
            <span id={`${baseId}-${i}`} className="sidebar__group-label">
              {g.label}
            </span>
            {g.items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className="sidebar__link">
                {item.sparkle ? (
                  <SparkleIcon size={18} />
                ) : (
                  <item.icon aria-hidden="true" size={18} strokeWidth={1.75} />
                )}
                <span>{item.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar__foot">
        <NavLink to="/preferencias" className="sidebar__link">
          <SlidersHorizontal aria-hidden="true" size={18} strokeWidth={1.75} />
          <span>Preferências</span>
        </NavLink>
        {me ? (
          <div className="sidebar__user">
            <Avatar name={me.name} tone="income" />
            <span className="sidebar__user-name">{me.name}</span>
            <button
              type="button"
              className="ui-icon-btn"
              aria-label="Sair"
              title="Sair"
              disabled={leaving}
              onClick={() => {
                setLeaving(true);
                void logout().finally(() => setLeaving(false));
              }}
            >
              <LogOut aria-hidden="true" size={18} strokeWidth={1.75} />
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
