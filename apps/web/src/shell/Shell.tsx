import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import { BottomBar } from "./BottomBar";
import { Header } from "./Header";
import { RouteSkeleton } from "./RouteSkeleton";
import { Sidebar } from "./Sidebar";
import { DESKTOP_QUERY, useMediaQuery } from "./useMediaQuery";
import "./shell.css";

/** Casca responsiva: barra flutuante no celular; menu lateral + cabeçalho no computador (≥ 1024px). */
export function Shell() {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const content = (
    <Suspense fallback={<RouteSkeleton />}>
      <Outlet />
    </Suspense>
  );

  if (desktop) {
    return (
      <div className="shell shell--desktop">
        <Sidebar />
        <div className="shell__col">
          <Header />
          <main className="shell-main shell-main--desktop">{content}</main>
        </div>
      </div>
    );
  }
  return (
    <div className="shell">
      <main className="shell-main">{content}</main>
      <BottomBar />
    </div>
  );
}
