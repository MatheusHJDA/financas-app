import { Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Outlet } from "react-router-dom";
import { useAuthConfig } from "../auth/passkeyLogin";
import { useAwayLogout } from "../auth/useAwayLogout";
import { BottomBar } from "./BottomBar";
import { Header } from "./Header";
import { PullIndicator } from "./PullIndicator";
import { RouteSkeleton } from "./RouteSkeleton";
import { Sidebar } from "./Sidebar";
import { usePullToRefresh } from "./usePullToRefresh";
import { DESKTOP_QUERY, useMediaQuery } from "../ui/useMediaQuery";
import "./shell.css";

/** Casca responsiva: barra flutuante no celular; menu lateral + cabeçalho no computador (≥ 1024px). */
export function Shell() {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const queryClient = useQueryClient();
  const config = useAuthConfig();
  useAwayLogout(config.data?.passkey_required === true);
  const { distance, refreshing, armed } = usePullToRefresh({
    enabled: !desktop,
    onRefresh: async () => {
      void navigator.serviceWorker?.getRegistration().then((r) => r?.update());
      await queryClient.invalidateQueries();
    },
  });
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
      <PullIndicator distance={distance} refreshing={refreshing} armed={armed} />
      <main className="shell-main">{content}</main>
      <BottomBar />
    </div>
  );
}
