import { useQuery } from "@tanstack/react-query";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { api } from "../api/client";
import type { Me } from "./AuthProvider";
import { deviceLabel } from "./deviceLabel";

export class LoginError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const CANCELLED = "cancelado";

export async function fetchAuthConfig(): Promise<{ passkey_required: boolean }> {
  const { data, response } = await api.GET("/auth/config");
  if (!data) throw new Error(`HTTP ${response.status}`);
  return data;
}

/** Se a chave de acesso é exigida; enquanto não carrega (ou se falhar) vale o modo só com PIN. */
export function useAuthConfig() {
  return useQuery({ queryKey: ["auth-config"], queryFn: fetchAuthConfig, staleTime: Infinity, retry: 1 });
}

/** Só caminhos internos (começam com `/`, nunca `//`); qualquer outra coisa volta para a tela inicial. */
export function safeNext(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\")) return raw;
  return "/";
}

interface PasskeyLoginInput {
  name: string;
  pin: string;
  releaseCode: string | null;
}

/** start (confere nome e PIN) → Face ID/digital/Hello → finish (abre a sessão). */
export async function passkeyLogin({
  name,
  pin,
  releaseCode,
}: PasskeyLoginInput): Promise<{ me: Me; recoveryCodes: string[] | null }> {
  const started = await api.POST("/auth/login/start", {
    body: { name, pin, device_label: deviceLabel(), release_code: releaseCode },
  });
  if (!started.data) throw new LoginError(started.response.status, `HTTP ${started.response.status}`);
  const { attempt_id, mode, options } = started.data;

  let credential: object;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opções vêm do servidor como JSON
    const optionsJSON = options as any;
    credential =
      mode === "register" ? await startRegistration({ optionsJSON }) : await startAuthentication({ optionsJSON });
  } catch (e) {
    if (e instanceof Error && e.name === "NotAllowedError") throw new LoginError(0, CANCELLED);
    throw e;
  }

  const finished = await api.POST("/auth/login/finish", {
    body: { attempt_id, credential: credential as { [key: string]: unknown } },
  });
  if (!finished.data) throw new LoginError(finished.response.status, `HTTP ${finished.response.status}`);
  return { me: finished.data.me, recoveryCodes: finished.data.recovery_codes };
}
