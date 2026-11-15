import { Search, SlidersHorizontal } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Button, Chip, ChipGroup, MonthSwitcher } from "../../ui";
import { accountOptionLabel, OWNER_LABEL, type Account, type Category, type Owner } from "../accounts/shared";
import { KIND_LABEL, KINDS, type TxKind } from "../chat/types";
import { currentMonthSP, selectedMonth, type PeriodMode, type TxFilters } from "./filters";

interface Props {
  filters: TxFilters;
  accounts: Account[];
  categories: Category[];
  /** Texto digitado na busca (só vira filtro ao enviar). */
  search: string;
  canClear: boolean;
  onSearchChange: (text: string) => void;
  onSearch: () => void;
  onChange: (patch: Partial<TxFilters>) => void;
  onClear: () => void;
}

const OWNER_CHOICES: { value: Owner | ""; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "RUTH", label: OWNER_LABEL.RUTH },
  { value: "MATHEUS", label: OWNER_LABEL.MATHEUS },
  { value: "AMBOS", label: OWNER_LABEL.AMBOS },
];

const KIND_CHOICES: { value: TxKind | ""; label: string }[] = [
  { value: "", label: "Todos" },
  ...KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })),
];

const PERIOD_CHOICES: { value: PeriodMode; label: string }[] = [
  { value: "all", label: "Todos os meses" },
  { value: "this", label: "Esse mês" },
  { value: "last", label: "Mês passado" },
  { value: "month", label: "Escolher mês" },
  { value: "range", label: "Período" },
];

export function TransactionFilters({
  filters,
  accounts,
  categories,
  search,
  canClear,
  onSearchChange,
  onSearch,
  onChange,
  onClear,
}: Props) {
  const uid = useId();
  const [moreOpen, setMoreOpen] = useState(false);
  const id = (f: string) => `${uid}-${f}`;
  const extra = (filters.accountId ? 1 : 0) + (filters.categoryId ? 1 : 0);
  const month = selectedMonth(filters);

  const choosePeriod = (period: PeriodMode) => {
    if (period === "month") onChange({ period, month: month ?? currentMonthSP() });
    else onChange({ period });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSearch();
  };

  return (
    <div className="tx-filters" role="group" aria-label="Filtros">
      <ChipGroup label="Mês">
        {PERIOD_CHOICES.map((p) => (
          <Chip key={p.value} selected={filters.period === p.value} onClick={() => choosePeriod(p.value)}>
            {p.label}
          </Chip>
        ))}
      </ChipGroup>

      {filters.period === "month" && month ? (
        <MonthSwitcher month={month} onChange={(next) => onChange({ period: "month", month: next })} />
      ) : null}

      {filters.period === "range" ? (
        <div className="tx-range">
          <div className="tx-field">
            <label htmlFor={id("from")}>De (data)</label>
            <input id={id("from")} type="date" value={filters.dateFrom} onChange={(e) => onChange({ dateFrom: e.target.value })} />
          </div>
          <div className="tx-field">
            <label htmlFor={id("to")}>Até (data)</label>
            <input id={id("to")} type="date" value={filters.dateTo} onChange={(e) => onChange({ dateTo: e.target.value })} />
          </div>
        </div>
      ) : null}

      <ChipGroup label="Dono">
        {OWNER_CHOICES.map((o) => (
          <Chip key={o.value || "todos"} selected={filters.owner === o.value} onClick={() => onChange({ owner: o.value })}>
            {o.label}
          </Chip>
        ))}
      </ChipGroup>

      <ChipGroup label="Tipo">
        {KIND_CHOICES.map((k) => (
          <Chip key={k.value || "todos"} selected={filters.kind === k.value} onClick={() => onChange({ kind: k.value })}>
            {k.label}
          </Chip>
        ))}
      </ChipGroup>

      <div>
        <Button
          variant="ghost"
          icon={SlidersHorizontal}
          aria-expanded={moreOpen}
          aria-controls={id("more")}
          onClick={() => setMoreOpen((open) => !open)}
        >
          {extra > 0 ? `Mais filtros (${extra})` : "Mais filtros"}
        </Button>
      </div>
      <div id={id("more")} className="tx-more" hidden={!moreOpen}>
        <div className="tx-field">
          <label htmlFor={id("account")}>Conta</label>
          <select id={id("account")} value={filters.accountId} onChange={(e) => onChange({ accountId: e.target.value })}>
            <option value="">Todas as contas</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {accountOptionLabel(a)}
              </option>
            ))}
          </select>
        </div>
        <div className="tx-field">
          <label htmlFor={id("category")}>Categoria</label>
          <select id={id("category")} value={filters.categoryId} onChange={(e) => onChange({ categoryId: e.target.value })}>
            <option value="">Todas as categorias</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <form className="tx-search" role="search" onSubmit={submit}>
        <label htmlFor={id("q")} className="visually-hidden">
          Buscar na descrição
        </label>
        <span className="tx-search__box">
          <Search aria-hidden="true" size={18} strokeWidth={1.75} />
          <input
            id={id("q")}
            type="search"
            autoComplete="off"
            placeholder="Buscar na descrição"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </span>
        <Button type="submit" variant="primary">
          Buscar
        </Button>
        {canClear ? <Button onClick={onClear}>Limpar filtros</Button> : null}
      </form>
    </div>
  );
}
