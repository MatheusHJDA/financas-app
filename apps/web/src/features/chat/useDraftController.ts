import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { api } from "../../api/client";
import type { Draft, IngestResult, Proposal, Transaction } from "./types";

/** Estado de um cartão na tela (o servidor só sabe pending/confirmed/discarded). */
export interface DraftView {
  status: "pending" | "confirmed" | "discarded";
  busy: boolean;
  error: string | null;
  note: string | null;
  /** Proposta editada pelo usuário; é ela que vai no Confirmar. */
  edited: Proposal | null;
  transactionId: number | null;
  bill: "idle" | "paying" | "paid";
  billError: string | null;
}

export interface ConfirmItem {
  draft: Draft;
  edited: Proposal | null;
}

const NEW_VIEW: DraftView = {
  status: "pending",
  busy: false,
  error: null,
  note: null,
  edited: null,
  transactionId: null,
  bill: "idle",
  billError: null,
};

export const NETWORK_ERROR = "Sem conexão com o servidor. Tente de novo.";
const GENERIC_ERROR = "Não foi possível concluir agora. Tente de novo.";
const FORBIDDEN_ERROR = "Você não pode lançar nessa conta.";
const RESOLVED_NOTE = "Esse rascunho já foi resolvido.";
const BATCH_CONFLICT_ERROR = "Outro item do lote já tinha sido resolvido, então nada foi gravado. Confirme este de novo.";

/**
 * Avisos que a API manda em cabeçalhos ao gravar um lançamento (POST /transactions e
 * /drafts/{id}/confirm): possível duplicata e "regra do plano".
 */
export function serverWarnings(response: Response): string | null {
  const parts: string[] = [];
  const dup = response.headers.get("X-Possible-Duplicate-Of");
  if (dup) parts.push(`Já existe? Parece com o lançamento nº ${dup.split(",").join(", nº ")}.`);
  const rule = response.headers.get("X-Plan-Rule-Warning");
  if (rule) parts.push(`Regra do plano: ${rule}`);
  return parts.length > 0 ? parts.join(" ") : null;
}

// Depois de gravar, o que mais telas mostram fica velho.
const INVALIDATE = [["transactions"], ["overview"], ["accounts"], ["bill-instances"]] as const;

function detailOf(error: unknown): string | null {
  const d = (error as { detail?: unknown } | undefined)?.detail;
  return typeof d === "string" && d ? d : null;
}

function messageFor(status: number, error: unknown): string {
  if (status === 403) return FORBIDDEN_ERROR;
  if (status === 422) return detailOf(error) ?? "Os dados não foram aceitos. Confira os campos.";
  if (status === 404) return "Esse rascunho não existe mais.";
  return detailOf(error) ?? GENERIC_ERROR;
}

/**
 * Ações dos cartões. Nada aqui roda sozinho: cada função só é chamada por um toque do usuário
 * (Confirmar, Descartar, Confirmar todos, Marcar como paga).
 */
export function useDraftController() {
  const queryClient = useQueryClient();
  const [views, setViews] = useState<Record<number, DraftView>>({});
  // Guarda síncrona contra duplo toque (o estado só atualiza no próximo render).
  const inflight = useRef(new Set<string>());
  const extractionOf = useRef(new Map<number, number>());

  const patch = useCallback((id: number, changes: Partial<DraftView>) => {
    setViews((prev) => ({ ...prev, [id]: { ...(prev[id] ?? NEW_VIEW), ...changes } }));
  }, []);

  const register = useCallback((result: IngestResult) => {
    for (const d of result.drafts) extractionOf.current.set(d.id, result.extraction_id);
    setViews((prev) => {
      const next = { ...prev };
      for (const d of result.drafts) next[d.id] ??= { ...NEW_VIEW, status: d.status };
      return next;
    });
  }, []);

  const afterWrite = useCallback(() => {
    for (const key of INVALIDATE) void queryClient.invalidateQueries({ queryKey: key });
  }, [queryClient]);

  /** 409: alguém já resolveu. Busca o estado real da extração e atualiza os cartões. */
  const syncExtraction = useCallback(
    async (draftIds: number[]) => {
      const extractionId = extractionOf.current.get(draftIds[0]);
      let resolved = false;
      const done = new Set<number>();
      if (extractionId !== undefined) {
        try {
          const { data } = await api.GET("/ingest/{extraction_id}", {
            params: { path: { extraction_id: extractionId } },
          });
          for (const d of data?.drafts ?? []) {
            if (draftIds.includes(d.id) && d.status !== "pending") {
              // a edição local não foi gravada: o cartão passa a mostrar o que o servidor tem
              patch(d.id, { status: d.status, busy: false, error: null, note: RESOLVED_NOTE, edited: null });
              resolved = true;
              done.add(d.id);
            }
          }
        } catch {
          // sem rede: cai na mensagem genérica abaixo
        }
      }
      for (const id of draftIds) {
        if (done.has(id)) continue;
        // lote atômico: se outro item já estava resolvido, este também não foi gravado
        patch(id, { busy: false, error: resolved ? BATCH_CONFLICT_ERROR : GENERIC_ERROR });
      }
    },
    [patch],
  );

  const confirmOne = useCallback(
    async ({ draft, edited }: ConfirmItem) => {
      const key = `draft:${draft.id}`;
      if (inflight.current.has(key)) return;
      inflight.current.add(key);
      patch(draft.id, { busy: true, error: null });
      try {
        const { data, response, error } = await api.POST("/drafts/{id}/confirm", {
          params: { path: { id: draft.id } },
          ...(edited ? { body: edited } : {}),
        });
        if (data) {
          patch(draft.id, {
            status: "confirmed",
            busy: false,
            transactionId: data.id,
            note: serverWarnings(response),
          });
          afterWrite();
        } else if (response.status === 409) {
          await syncExtraction([draft.id]);
        } else {
          patch(draft.id, { busy: false, error: messageFor(response.status, error) });
        }
      } catch {
        patch(draft.id, { busy: false, error: NETWORK_ERROR });
      } finally {
        inflight.current.delete(key);
      }
    },
    [patch, afterWrite, syncExtraction],
  );

  const discard = useCallback(
    async (draft: Draft) => {
      const key = `draft:${draft.id}`;
      if (inflight.current.has(key)) return;
      inflight.current.add(key);
      patch(draft.id, { busy: true, error: null });
      try {
        const { response, error } = await api.POST("/drafts/{id}/discard", {
          params: { path: { id: draft.id } },
        });
        if (response.ok) patch(draft.id, { status: "discarded", busy: false, note: null });
        else if (response.status === 409) await syncExtraction([draft.id]);
        else patch(draft.id, { busy: false, error: messageFor(response.status, error) });
      } catch {
        patch(draft.id, { busy: false, error: NETWORK_ERROR });
      } finally {
        inflight.current.delete(key);
      }
    },
    [patch, syncExtraction],
  );

  /**
   * Confirmar todos: os sem edição vão juntos em /drafts/confirm-batch; os editados vão um a um
   * (o lote só leva ids, então a edição se perderia).
   */
  const confirmMany = useCallback(
    async (items: ConfirmItem[]) => {
      const fresh = items.filter((i) => !inflight.current.has(`draft:${i.draft.id}`));
      if (fresh.length === 0) return;
      for (const i of fresh) {
        inflight.current.add(`draft:${i.draft.id}`);
        patch(i.draft.id, { busy: true, error: null });
      }
      const plain = fresh.filter((i) => !i.edited);
      const edited = fresh.filter((i) => i.edited);
      try {
        if (plain.length > 0) {
          const ids = plain.map((i) => i.draft.id);
          try {
            const { data, response, error } = await api.POST("/drafts/confirm-batch", {
              body: { draft_ids: ids },
            });
            if (data) {
              const sameShape = (tx: Transaction | undefined, d: Draft) =>
                tx !== undefined && tx.amount_cents === d.payload.amount_cents &&
                tx.kind === d.payload.kind &&
                tx.description === d.payload.description;
              plain.forEach((i, idx) => {
                const tx: Transaction | undefined = data.length === plain.length ? data[idx] : undefined;
                patch(i.draft.id, {
                  status: "confirmed",
                  busy: false,
                  note: null,
                  // só liga ao lançamento se a posição bate e o valor confere
                  transactionId: sameShape(tx, i.draft) ? (tx?.id ?? null) : null,
                });
              });
              afterWrite();
            } else if (response.status === 409) {
              await syncExtraction(ids);
            } else {
              for (const id of ids) patch(id, { busy: false, error: messageFor(response.status, error) });
            }
          } catch {
            for (const id of ids) patch(id, { busy: false, error: NETWORK_ERROR });
          }
        }
        for (const item of edited) {
          inflight.current.delete(`draft:${item.draft.id}`); // confirmOne retoma a guarda
          await confirmOne(item);
        }
      } finally {
        for (const i of fresh) inflight.current.delete(`draft:${i.draft.id}`);
      }
    },
    [patch, afterWrite, syncExtraction, confirmOne],
  );

  /** "Marcar como paga?" — só depois do Confirmar e só com toque. */
  const payBill = useCallback(
    async (draftId: number, billInstanceId: number, transactionId: number) => {
      const key = `bill:${billInstanceId}`;
      if (inflight.current.has(key)) return;
      inflight.current.add(key);
      patch(draftId, { bill: "paying", billError: null });
      try {
        const { response, error } = await api.POST("/bill-instances/{id}/pay", {
          params: { path: { id: billInstanceId } },
          body: { transaction_id: transactionId },
        });
        if (response.ok) {
          patch(draftId, { bill: "paid" });
          for (const key of [["bill-instances"], ["overview"], ["transactions"]]) {
            void queryClient.invalidateQueries({ queryKey: key });
          }
        } else {
          const msg =
            response.status === 409
              ? "Essa conta já está paga."
              : response.status === 404
                ? "Não encontrei essa conta a pagar."
                : (detailOf(error) ?? GENERIC_ERROR);
          patch(draftId, { bill: "idle", billError: msg });
        }
      } catch {
        patch(draftId, { bill: "idle", billError: NETWORK_ERROR });
      } finally {
        inflight.current.delete(key);
      }
    },
    [patch, queryClient],
  );

  const setEdited = useCallback((id: number, edited: Proposal | null) => patch(id, { edited }), [patch]);

  return { views, register, confirmOne, confirmMany, discard, payBill, setEdited };
}
