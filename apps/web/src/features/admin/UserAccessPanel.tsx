import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../ui";
import { PasskeyList } from "../settings/PasskeyList";
import { createReleaseCode, errorText, fetchUserPasskeys, USERS_KEY, userPasskeysKey, type AdminUser } from "./adminApi";
import { formatDateTime } from "./format";

/** Chaves da pessoa e código de liberação (24 h, uso único), dentro de Administração → Usuários. */
export function UserAccessPanel({ user }: { user: AdminUser }) {
  const queryClient = useQueryClient();
  const keys = useQuery({ queryKey: userPasskeysKey(user.id), queryFn: () => fetchUserPasskeys(user.id) });
  const [copied, setCopied] = useState<"ok" | "manual" | null>(null);
  const release = useMutation({
    mutationFn: () => createReleaseCode(user.id),
    onMutate: () => setCopied(null),
  });

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied("ok");
    } catch {
      setCopied("manual");
    }
  }

  return (
    <div className="admin-access">
      <h3>Chaves de {user.name}</h3>
      {keys.isError ? (
        <p className="admin-notice--error" role="alert">
          Não foi possível carregar as chaves.
        </p>
      ) : keys.data ? (
        <PasskeyList
          keys={keys.data}
          confirmMessage={`Remover a chave de ${user.name}? Todos os aparelhos da pessoa saem da conta, e o desta chave vai precisar de um código de liberação para entrar de novo.`}
          onRemoved={() =>
            Promise.all([
              queryClient.invalidateQueries({ queryKey: userPasskeysKey(user.id) }),
              queryClient.invalidateQueries({ queryKey: USERS_KEY }),
            ])
          }
        />
      ) : (
        <p className="muted">Carregando…</p>
      )}
      <Button onClick={() => release.mutate()} disabled={release.isPending}>
        Gerar código de liberação
      </Button>
      {release.isError ? (
        <p className="admin-notice--error" role="alert">
          {errorText(release.error, "Não foi possível gerar o código.")}
        </p>
      ) : null}
      {release.data ? (
        <div className="admin-code" role="status">
          <p className="admin-code__value">{release.data.code}</p>
          <p className="muted">vale até {formatDateTime(release.data.expires_at)} · uso único</p>
          <Button onClick={() => void copy(release.data.code)}>{copied === "ok" ? "Copiado" : "Copiar"}</Button>
          {copied === "manual" ? <p className="muted">Copie manualmente</p> : null}
        </div>
      ) : null}
    </div>
  );
}
