import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  ListItem,
  Money,
  Sheet,
  Skeleton,
  SkeletonGroup,
  type Tone,
} from "../../ui";
import { AccountForm } from "./AccountFormFields";
import { accountToForm, emptyAccountForm, type AccountBody } from "./accountForm";
import { CoupleTotal, InvoicesAndDebts, ownerTotalCents, type Overview } from "./BalancesSection";
import { useAllAccounts } from "./queries";
import {
  ACCOUNT_TYPE_LABEL,
  OWNER_LABEL,
  OWNERS,
  assertOk,
  canWrite,
  errorMessage,
  type Account,
  type AccountType,
  type Owner,
} from "./shared";
import "./ui.css";
import "./accounts.css";

type Editing = { kind: "new" } | { kind: "edit"; account: Account } | null;

async function loadOverview(): Promise<Overview> {
  const { data, response } = await api.GET("/overview");
  if (!data) throw new Error(`HTTP ${response.status}`);
  return data;
}

const TONE: Record<AccountType, Tone> = {
  checking: "income",
  savings: "info",
  cash: "warning",
  meal_voucher: "warning",
  credit_card: "expense",
  loan: "expense",
};

/** Contas: saldos por dono (totais vindos da API), faturas abertas, dívidas; criar e editar em painel. */
export default function AccountsPage() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const accounts = useAllAccounts();
  const overview = useQuery({ queryKey: ["overview"], queryFn: loadOverview });
  const [editing, setEditing] = useState<Editing>(null);
  const [notice, setNotice] = useState("");

  const save = useMutation({
    mutationFn: async (input: { id: number | null; body: AccountBody }) => {
      if (input.id === null) {
        const { response, error } = await api.POST("/accounts", { body: input.body });
        assertOk(response, error);
      } else {
        const { response, error } = await api.PATCH("/accounts/{id}", {
          params: { path: { id: input.id } },
          body: input.body,
        });
        assertOk(response, error);
      }
    },
    onSuccess: async (_data, input) => {
      setEditing(null);
      setNotice(input.id === null ? "Conta criada." : "Conta atualizada.");
      await Promise.all(
        ["accounts", "overview", "goals"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
      );
    },
  });

  const open = (next: Editing) => {
    save.reset();
    setNotice("");
    setEditing(next);
  };

  const groups = OWNERS.map((owner) => ({
    owner,
    items: (accounts.data ?? []).filter((a) => a.owner === owner),
  })).filter((g) => g.items.length > 0);

  return (
    <section className="acc-page">
      <header className="acc-head">
        <h1>Contas</h1>
        <Button variant="primary" icon={Plus} onClick={() => open({ kind: "new" })}>
          Nova conta
        </Button>
      </header>
      <p className="u8-sr" role="status" aria-live="polite">
        {notice}
      </p>

      {overview.isLoading ? (
        <SkeletonGroup label="Carregando saldos">
          <Skeleton variant="block" height="76px" />
        </SkeletonGroup>
      ) : null}
      {overview.isError ? (
        <ErrorState message="Não foi possível carregar os saldos." onRetry={() => void overview.refetch()} />
      ) : null}
      {overview.data ? <CoupleTotal overview={overview.data} /> : null}

      <div className="acc-cols">
        <div className="acc-col">
          {accounts.isLoading ? <AccountsSkeleton /> : null}
          {accounts.isError ? (
            <ErrorState message="Não foi possível carregar as contas." onRetry={() => void accounts.refetch()} />
          ) : null}
          {accounts.data && groups.length === 0 ? (
            <EmptyState title="Nenhuma conta ainda" hint="Cadastre a primeira conta para começar a lançar." />
          ) : null}
          {groups.map(({ owner, items }) => (
            <OwnerGroup
              key={owner}
              owner={owner}
              accounts={items}
              totalCents={ownerTotalCents(overview.data, owner)}
              canEdit={(a) => canWrite(me, a.owner)}
              onEdit={(account) => open({ kind: "edit", account })}
            />
          ))}
        </div>
        {overview.data ? (
          <div className="acc-col">
            <InvoicesAndDebts overview={overview.data} />
          </div>
        ) : null}
      </div>

      <Sheet
        open={editing !== null}
        title={editing?.kind === "edit" ? "Editar conta" : "Nova conta"}
        onClose={() => open(null)}
      >
        {editing?.kind === "new" ? (
          <AccountForm
            initial={emptyAccountForm(me?.owner ?? "AMBOS")}
            submitLabel="Criar conta"
            busy={save.isPending}
            serverError={save.isError ? errorMessage(save.error, "Você não pode criar conta para esse dono.") : null}
            onSubmit={(body) => save.mutate({ id: null, body })}
            onCancel={() => open(null)}
          />
        ) : null}
        {editing?.kind === "edit" ? (
          <AccountForm
            key={editing.account.id}
            editing
            initial={accountToForm(editing.account)}
            submitLabel="Salvar conta"
            busy={save.isPending}
            serverError={save.isError ? errorMessage(save.error, "Você não pode alterar essa conta.") : null}
            onSubmit={(body) => save.mutate({ id: editing.account.id, body })}
            onCancel={() => open(null)}
          />
        ) : null}
      </Sheet>
    </section>
  );
}

interface GroupProps {
  owner: Owner;
  accounts: Account[];
  /** Total do dono segundo a API; `null` enquanto não chegou (não se soma no front). */
  totalCents: number | null;
  canEdit: (a: Account) => boolean;
  onEdit: (a: Account) => void;
}

function OwnerGroup({ owner, accounts, totalCents, canEdit, onEdit }: GroupProps) {
  const label = OWNER_LABEL[owner];
  return (
    <div role="group" aria-label={`Saldos de ${label}`}>
      <Card>
        <div className="acc-group__head">
          <h2 className="acc-group__title">{label}</h2>
          {totalCents !== null ? (
            <p className="acc-group__total" style={{ margin: 0 }}>
              <span>Total de {label}</span>
              <Money cents={totalCents} />
            </p>
          ) : null}
        </div>
        <ul className="acc-list">
          {accounts.map((a) => (
            <li key={a.id}>
              <ListItem
                leading={<Avatar name={a.name} tone={a.active ? TONE[a.type] : "neutral"} />}
                title={a.name}
                subtitle={`${ACCOUNT_TYPE_LABEL[a.type]}${a.active ? "" : " · inativa"}`}
                trailing={
                  <span className="acc-trail">
                    <Money cents={a.current_balance_cents} className={a.current_balance_cents < 0 ? "acc-neg" : undefined} />
                    {canEdit(a) ? (
                      <IconButton icon={Pencil} label={`Editar conta ${a.name}`} onClick={() => onEdit(a)} />
                    ) : null}
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/** Esqueleto com a forma dos grupos: cartão com bolha + duas linhas + valor, por conta. */
function AccountsSkeleton() {
  return (
    <SkeletonGroup label="Carregando contas">
      {[0, 1, 2].map((i) => (
        <div key={i} className="acc-skel-row">
          <Skeleton variant="circle" />
          <div className="acc-skel-text">
            <Skeleton width="50%" />
            <Skeleton width="30%" />
          </div>
          <Skeleton width="72px" />
        </div>
      ))}
    </SkeletonGroup>
  );
}
