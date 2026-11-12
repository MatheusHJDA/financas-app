import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./schema";

type UnauthorizedListener = () => void;

let unauthorizedListener: UnauthorizedListener | null = null;

/** Registra quem reage a um 401 (o AuthProvider limpa a sessão e leva ao login). */
export function onUnauthorized(listener: UnauthorizedListener | null): void {
  unauthorizedListener = listener;
}

// 401 esperado nestas rotas: tratado pelo próprio chamador (PIN errado / sem sessão).
const SILENT_401 = ["/auth/login", "/auth/me"];

const unauthorizedMiddleware: Middleware = {
  onResponse({ response, schemaPath }) {
    if (response.status === 401 && !SILENT_401.includes(schemaPath)) unauthorizedListener?.();
    return undefined;
  },
};

export const api = createClient<paths>({
  // URL absoluta: Request exige base fora do navegador (testes).
  baseUrl: `${globalThis.location.origin}/api`,
  credentials: "include",
  // Resolve fetch na hora da chamada (permite simular em testes).
  fetch: (request) => globalThis.fetch(request),
});

api.use(unauthorizedMiddleware);
