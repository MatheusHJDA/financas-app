import { Chip, ChipGroup } from "../../ui";
import type { Category } from "../accounts/shared";
import { isFiltering, type BillFilterState, type BillStatusFilter } from "./billFilters";

const STATUS_OPTIONS: { value: BillStatusFilter; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "open", label: "A pagar" },
  { value: "paid", label: "Pagas" },
  { value: "overdue", label: "Vencidas" },
];

interface Props {
  value: BillFilterState;
  categories: Category[];
  onChange: (next: BillFilterState) => void;
  onClear: () => void;
}

/** Situação (do mês atual) e Categoria; valem para "Contas a pagar" e "Cadastradas". */
export function BillFilterBar({ value, categories, onChange, onClear }: Props) {
  return (
    <div className="bill-filters">
      <ChipGroup label="Situação">
        {STATUS_OPTIONS.map((o) => (
          <Chip key={o.value} selected={value.status === o.value} onClick={() => onChange({ ...value, status: o.value })}>
            {o.label}
          </Chip>
        ))}
      </ChipGroup>
      <label className="bill-filters__cat">
        <span>Categoria</span>
        <select
          value={value.categoryId === null ? "" : String(value.categoryId)}
          onChange={(e) => onChange({ ...value, categoryId: e.target.value === "" ? null : Number(e.target.value) })}
        >
          <option value="">Todas</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {isFiltering(value) ? (
        <button type="button" className="bill-filters__clear" onClick={onClear}>
          Limpar filtros
        </button>
      ) : null}
    </div>
  );
}
