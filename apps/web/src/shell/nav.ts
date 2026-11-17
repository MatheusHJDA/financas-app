import {
  Activity,
  BarChart3,
  Bell,
  CalendarClock,
  CalendarRange,
  Cpu,
  Home,
  Tags,
  Landmark,
  LayoutDashboard,
  ListChecks,
  MoreHorizontal,
  ReceiptText,
  ScrollText,
  Settings,
  SlidersHorizontal,
  Target,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

// Fonte única dos menus (spec 2026-11-14, "Navegação"). Celular, menu lateral e tela Mais leem daqui.

export type NavItem = { to: string; label: string; icon: LucideIcon; adminOnly?: boolean; end?: boolean };

/** Barra do celular. O item `sparkle` é o botão central ✦ (desenhado à parte no BottomBar). */
export const MOBILE_TABS: (NavItem & { sparkle?: boolean })[] = [
  { to: "/", label: "Início", icon: Home, end: true },
  { to: "/transacoes", label: "Transações", icon: ReceiptText },
  { to: "/lancar", label: "Lançar com IA", icon: Home, sparkle: true },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
  { to: "/mais", label: "Mais", icon: MoreHorizontal },
];

export type AdminSlug = "usuarios" | "configuracoes" | "avisos" | "ia" | "auditoria" | "sistema";

export const ADMIN_SECTIONS: { slug: AdminSlug; label: string; icon: LucideIcon }[] = [
  { slug: "usuarios", label: "Usuários", icon: Users },
  { slug: "configuracoes", label: "Configurações", icon: Settings },
  { slug: "avisos", label: "Avisos do sistema", icon: Bell },
  { slug: "ia", label: "IA", icon: Cpu },
  { slug: "auditoria", label: "Auditoria", icon: ScrollText },
  { slug: "sistema", label: "Sistema", icon: Activity },
];

/** Grupos do menu lateral. O item com `sparkle` mostra a ✦ no lugar do ícone. */
export const SIDEBAR_GROUPS: { label: string; adminOnly?: boolean; items: (NavItem & { sparkle?: boolean })[] }[] = [
  {
    label: "Controle",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
      { to: "/transacoes", label: "Transações", icon: ReceiptText },
      { to: "/contas-fixas", label: "Contas fixas", icon: CalendarClock },
      { to: "/contas", label: "Contas", icon: Wallet },
      { to: "/categorias", label: "Categorias", icon: Tags },
    ],
  },
  {
    label: "Planejamento",
    items: [
      { to: "/metas", label: "Metas", icon: Target },
      { to: "/dividas", label: "Dívidas", icon: Landmark },
      { to: "/plano", label: "Plano", icon: CalendarRange },
      { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
    ],
  },
  { label: "IA", items: [{ to: "/lancar", label: "Lançar com IA", icon: ListChecks, sparkle: true }] },
  {
    label: "Administração",
    adminOnly: true,
    items: ADMIN_SECTIONS.map((s) => ({ to: `/admin/${s.slug}`, label: s.label, icon: s.icon, adminOnly: true })),
  },
];

/** Itens da tela Mais (celular). */
export const MORE_ITEMS: NavItem[] = [
  { to: "/metas", label: "Metas", icon: Target },
  { to: "/dividas", label: "Dívidas", icon: Landmark },
  { to: "/plano", label: "Plano", icon: CalendarRange },
  { to: "/contas-fixas", label: "Contas fixas", icon: CalendarClock },
  { to: "/contas", label: "Contas", icon: Wallet },
  { to: "/categorias", label: "Categorias", icon: Tags },
  { to: "/preferencias", label: "Preferências", icon: SlidersHorizontal },
  { to: "/admin/usuarios", label: "Administração", icon: Settings, adminOnly: true },
];

/** Título da rota atual (cabeçalho do computador). */
export function titleFor(pathname: string): string {
  if (pathname === "/") return "Dashboard";
  if (pathname.startsWith("/admin/")) {
    const s = ADMIN_SECTIONS.find((a) => pathname === `/admin/${a.slug}`);
    return s ? `Administração / ${s.label}` : "Administração";
  }
  if (pathname.startsWith("/dividas")) return "Dívidas";
  const all = [...SIDEBAR_GROUPS.flatMap((g) => g.items), ...MORE_ITEMS, ...MOBILE_TABS];
  return all.find((i) => i.to === pathname)?.label ?? "";
}
