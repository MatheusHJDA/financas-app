// Apoio dos testes do painel admin (não é importado pelo app).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { AuthProvider } from "../../auth/AuthProvider";
import AdminPage from "./AdminPage";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export type Handler = (req: Request) => Response | Promise<Response>;

export interface Call {
  key: string;
  url: URL;
  req: Request;
}

/** fetch simulado por "MÉTODO /caminho" (sem o prefixo /api). */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (req: Request) => {
      const url = new URL(req.url);
      const key = `${req.method} ${url.pathname.replace(/^\/api/, "")}`;
      calls.push({ key, url, req });
      const handler = routes[key];
      return handler ? handler(req) : json({ detail: "não mockado" }, 500);
    }),
  );
  return calls;
}

export function renderAdmin() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <AdminPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

export const ME = { id: 1, name: "Matheus", role: "admin", owner: "MATHEUS" } as const;

export const USERS = [
  { id: 1, name: "Matheus", role: "admin", failed_attempts: 0, locked_until: null },
  { id: 2, name: "Ruth", role: "member", failed_attempts: 3, locked_until: "2999-01-01T12:00:00Z" },
];
