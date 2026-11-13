import type { IngestResult } from "./types";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const LIMIT_MESSAGE = "O limite mensal da IA foi atingido. Lance pelo formulário.";
export const UNAVAILABLE_MESSAGE = "A IA não está disponível agora. Lance pelo formulário.";

export type IngestErrorKind = "local" | "http" | "network" | "unauthorized" | "ai_limit" | "ai_unavailable";

/** Erro de envio já com texto para o usuário; `openManual` manda abrir o formulário manual. */
export class IngestError extends Error {
  constructor(
    readonly kind: IngestErrorKind,
    message: string,
    readonly openManual = false,
  ) {
    super(message);
    this.name = "IngestError";
  }
}

export interface SendIngestOptions {
  text?: string;
  file?: File | null;
  /** Porcentagem inteira (0–100) do envio do arquivo. */
  onProgress?: (percent: number) => void;
  /** 401: mesmo fluxo do cliente da API (limpa a sessão e leva ao login). */
  onUnauthorized?: () => void;
}

/** Valida o anexo antes de enviar; devolve a mensagem de erro ou null. */
export function validateAttachment(file: File): string | null {
  if (file.size > MAX_FILE_BYTES) return "O arquivo passa de 10 MB. Envie um arquivo menor.";
  if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
    return "Envie uma foto (imagem) ou um PDF.";
  }
  return null;
}

function parseBody(raw: string): { detail?: unknown; code?: unknown } & Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function errorFor(status: number, raw: string): IngestError {
  const body = parseBody(raw);
  const detail = typeof body.detail === "string" && body.detail ? body.detail : null;
  if (status === 503) {
    if (body.code === "ai_limit_reached") return new IngestError("ai_limit", LIMIT_MESSAGE, true);
    return new IngestError("ai_unavailable", UNAVAILABLE_MESSAGE, true);
  }
  if (status === 413) return new IngestError("http", detail ?? "O arquivo passa de 10 MB.");
  if (status === 422) return new IngestError("http", detail ?? "Não consegui ler esse envio.");
  return new IngestError("http", detail ?? "Não foi possível enviar agora. Tente de novo.");
}

/** POST /ingest (multipart) com progresso de upload — por isso XMLHttpRequest e não fetch. */
export function sendIngest({ text, file, onProgress, onUnauthorized }: SendIngestOptions): Promise<IngestResult> {
  const trimmed = text?.trim() ?? "";
  if (!trimmed && !file) return Promise.reject(new IngestError("local", "Escreva algo ou anexe uma foto ou PDF."));
  if (file) {
    const problem = validateAttachment(file);
    if (problem) return Promise.reject(new IngestError("local", problem));
  }

  return new Promise<IngestResult>((resolve, reject) => {
    const form = new FormData();
    if (trimmed) form.append("text", trimmed);
    if (file) form.append("file", file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${globalThis.location.origin}/api/ingest`);
    xhr.withCredentials = true;
    xhr.responseType = "text";
    xhr.timeout = 180_000; // a leitura pela IA pode demorar
    xhr.setRequestHeader("Accept", "application/json");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(Math.min(100, Math.round((e.loaded / e.total) * 100)));
    };
    // bytes enviados: daqui em diante é a leitura pela IA (a tela troca a barra pelo aviso)
    xhr.upload.onload = () => onProgress?.(100);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const body = parseBody(xhr.responseText);
        if (Array.isArray(body.drafts)) {
          onProgress?.(100);
          resolve(body as unknown as IngestResult);
        } else {
          reject(new IngestError("http", "Resposta inesperada do servidor. Tente de novo."));
        }
        return;
      }
      if (xhr.status === 401) {
        onUnauthorized?.();
        reject(new IngestError("unauthorized", "Sua sessão expirou. Entre de novo."));
        return;
      }
      reject(errorFor(xhr.status, xhr.responseText));
    };
    const network = () =>
      reject(new IngestError("network", "Sem conexão com o servidor. Verifique a internet e tente de novo."));
    xhr.onerror = network;
    xhr.ontimeout = network;
    xhr.onabort = network;

    xhr.send(form);
  });
}
