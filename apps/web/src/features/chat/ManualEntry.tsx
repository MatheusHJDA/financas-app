import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { Money, Skeleton, SkeletonGroup } from "../../ui";
import { ErrorState } from "../../ui/States";
import { formatDate } from "./dates";
import { emptyForm } from "./proposal";
import { serverWarnings } from "./useDraftController";
import { TransactionForm } from "./TransactionForm";
import { KIND_LABEL, type Account, type Category, type Owner, type Proposal } from "./types";

interface Props {
  accounts: Account[];
  categories: Category[];
  owner: Owner;
  /** Contas e categorias ainda carregando: mostra skeleton no lugar dos campos. */
  loading?: boolean;
  /** Falha ao carregar contas e categorias. */
  loadError?: boolean;
  onRetry?: () => void;
  /** Mensagem de contexto acima do formulário (ex.: a IA falhou). */
  reason?: string | null;
  /** Resumo em JSX (não string) para o valor passar pelo `Money` e respeitar o olho de ocultar. */
  onCreated: (summary: ReactNode) => void;
  onCancel: () => void;
}

/**
 * Lançamento sem IA: POST /transactions (o `source` é definido pelo servidor).
 * Conteúdo do `Sheet` "Lançar à mão" (o painel e o título ficam em ChatPage).
 */
export function ManualEntry({
  accounts,
  categories,
  owner,
  loading = false,
  loadError = false,
  onRetry,
  reason,
  onCreated,
  onCancel,
}: Props) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);

  const submit = async (p: Proposal) => {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError(null);
    try {
      const { data, response, error: body } = await api.POST("/transactions", {
        body: {
          kind: p.kind,
          amount_cents: p.amount_cents,
          date: p.date,
          description: p.description,
          account_id: p.account_id as number,
          to_account_id: p.to_account_id ?? null,
          category_id: p.category_id ?? null,
          owner: p.owner as Owner,
        },
      });
      if (data) {
        for (const key of ["transactions", "overview", "accounts", "bill-instances", "report"]) {
          void queryClient.invalidateQueries({ queryKey: [key] });
        }
        const summary = (
          <>
            {KIND_LABEL[p.kind]} de <Money cents={p.amount_cents} /> em {formatDate(p.date)}: {p.description}
          </>
        );
        const warning = serverWarnings(response);
        onCreated(
          warning ? (
            <>
              {summary}. {warning}
            </>
          ) : (
            summary
          ),
        );
      } else if (response.status === 403) {
        setError("Você não pode lançar nessa conta.");
      } else {
        const detail = (body as { detail?: unknown } | undefined)?.detail;
        setError(
          response.status === 422 && typeof detail === "string"
            ? detail
            : "Não foi possível salvar agora. Tente de novo.",
        );
      }
    } catch {
      setError("Sem conexão com o servidor. Tente de novo.");
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="manual">
      {reason ? <p className="manual__reason">{reason}</p> : null}

      {loading ? (
        <SkeletonGroup label="Carregando contas e categorias">
          <Skeleton variant="block" height="140px" />
          <Skeleton variant="line" height="48px" />
          <Skeleton variant="line" height="48px" />
          <Skeleton variant="line" height="48px" />
        </SkeletonGroup>
      ) : loadError && accounts.length === 0 ? (
        <ErrorState message="Não consegui carregar contas e categorias." onRetry={onRetry} />
      ) : (
        <TransactionForm
          variant="sheet"
          initial={emptyForm(owner)}
          accounts={accounts}
          categories={categories}
          submitLabel="Salvar lançamento"
          busy={busy}
          serverError={error}
          onSubmit={(p) => void submit(p)}
          onCancel={onCancel}
        />
      )}

      <p className="manual__hint">
        <Link to="/contas-fixas">Conta que se repete? Cadastre em Contas fixas</Link>
      </p>
    </div>
  );
}
