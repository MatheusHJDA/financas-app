import { Suspense } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { LoadingState } from "../ui/States";

const TABS = [
  { to: "/", label: "Chat", icon: "💬", end: true },
  { to: "/geral", label: "Geral", icon: "📊", end: false },
  { to: "/metas", label: "Metas", icon: "🎯", end: false },
  { to: "/plano", label: "Plano", icon: "🗓️", end: false },
  { to: "/mais", label: "Mais", icon: "⋯", end: false },
];

export function Shell() {
  return (
    <div className="shell">
      <main className="shell-main">
        <Suspense fallback={<LoadingState />}>
          <Outlet />
        </Suspense>
      </main>
      <nav className="tabbar" aria-label="Principal">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className="tab">
            <span aria-hidden="true" className="tab-icon">
              {t.icon}
            </span>
            <span>{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
