import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { Card } from "../../ui";
import { ErrorState } from "../../ui/States";
import { fetchMyPasskeys, MY_PASSKEYS_KEY } from "../admin/adminApi";
import { PasskeyList } from "./PasskeyList";

// Aparece sempre, com a exigência de chave ligada ou não.
export function DevicesCard() {
  const queryClient = useQueryClient();
  const keys = useQuery({ queryKey: MY_PASSKEYS_KEY, queryFn: fetchMyPasskeys });
  return (
    <Card title="Aparelhos" icon={KeyRound}>
      {keys.isError ? (
        <ErrorState message="Não foi possível carregar as chaves." onRetry={() => void keys.refetch()} />
      ) : keys.data ? (
        <PasskeyList
          keys={keys.data}
          confirmMessage="Remover a chave deste aparelho? Ele vai precisar de um código de liberação para entrar de novo. Seus outros aparelhos também saem e entram de novo com a chave deles."
          onRemoved={() => queryClient.invalidateQueries({ queryKey: MY_PASSKEYS_KEY })}
        />
      ) : (
        <p className="muted">Carregando…</p>
      )}
    </Card>
  );
}
