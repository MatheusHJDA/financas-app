// Apoio dos testes da tela de chat (não é importado pelo app).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { AuthProvider } from "../../auth/AuthProvider";
import ChatPage from "./ChatPage";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export type Handler = (req: Request) => Response | Promise<Response>;

export interface Call {
  key: string;
  req: Request;
}

/** fetch simulado por "MÉTODO /caminho" (sem o prefixo /api). */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (req: Request) => {
      const key = `${req.method} ${new URL(req.url).pathname.replace(/^\/api/, "")}`;
      calls.push({ key, req });
      const handler = routes[key];
      return handler ? handler(req) : json({ detail: "não mockado" }, 500);
    }),
  );
  return calls;
}

/** XMLHttpRequest simulado: o teste decide quando e como a resposta chega. */
export class FakeXHR {
  static instances: FakeXHR[] = [];
  method = "";
  url = "";
  withCredentials = false;
  responseType = "";
  timeout = 0;
  status = 0;
  responseText = "";
  body: FormData | null = null;
  headers: Record<string, string> = {};
  upload: {
    onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
    onload: (() => void) | null;
  } = { onprogress: null, onload: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: FormData) {
    this.body = body;
    FakeXHR.instances.push(this);
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }
  /** Os bytes terminaram de subir (o servidor ainda não respondeu). */
  uploaded() {
    this.upload.onload?.();
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = typeof body === "string" ? body : JSON.stringify(body);
    this.onload?.();
  }
  fail() {
    this.onerror?.();
  }
}

export function installFakeXHR() {
  FakeXHR.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  return FakeXHR;
}

export function renderChat() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <ChatPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}
