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

/** Se a chave de acesso é exigida. Enquanto carrega, a tela espera; se falhar, mostra erro com nova tentativa (nunca cai no modo só com PIN). */
export function useAuthConfig() {
  return useQuery({ queryKey: ["auth-config"], queryFn: fetchAuthConfig, staleTime: Infinity, retry: 1, retryDelay: 300 });
}

/** Só caminhos internos (começam com `/`, nunca `//`); qualquer outra coisa volta para a tela inicial. */
export function safeNext(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\")) return raw;
  return "/";
}

export interface PasskeyAttempt {
  attemptId: string;
  mode: "login" | "register";
  options: Record<string, unknown>;
  startedAt: number;
}

/** A tentativa vale 2 min no servidor; depois de 100 s pedimos outra. */
export const ATTEMPT_MAX_AGE_MS = 100_000;
export const isFresh = (a: PasskeyAttempt) => Date.now() - a.startedAt < ATTEMPT_MAX_AGE_MS;

/** Passo 1: confere nome e PIN no servidor (não consome o código de liberação). */
export async function startPasskeyAttempt(input: {
  name: string;
  pin: string;
  releaseCode: string | null;
}): Promise<PasskeyAttempt> {
  const { data, response } = await api.POST("/auth/login/start", {
    body: { name: input.name, pin: input.pin, device_label: deviceLabel(), release_code: input.releaseCode },
  });
  if (!data) throw new LoginError(response.status, `HTTP ${response.status}`);
  return { attemptId: data.attempt_id, mode: data.mode, options: data.options, startedAt: Date.now() };
}

/**
 * Passo 2: Face ID/digital/Hello e finish. Chamar direto do toque: o WebAuthn é a primeira coisa
 * que roda, antes de qualquer await (o iOS exige o gesto do usuário).
 */
export function completePasskey(attempt: PasskeyAttempt): Promise<{ me: Me; recoveryCodes: string[] | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opções vêm do servidor como JSON
  const optionsJSON = attempt.options as any;
  const ceremony: Promise<object> =
    attempt.mode === "register" ? startRegistration({ optionsJSON }) : startAuthentication({ optionsJSON });
  return ceremony.then(
    async (credential) => {
      const { data, response } = await api.POST("/auth/login/finish", {
        body: { attempt_id: attempt.attemptId, credential: credential as { [key: string]: unknown } },
      });
      if (!data) throw new LoginError(response.status, `HTTP ${response.status}`);
      return { me: data.me, recoveryCodes: data.recovery_codes };
    },
    (e: unknown) => {
      if (e instanceof Error && e.name === "NotAllowedError") throw new LoginError(0, CANCELLED);
      throw e;
    },
  );
}
