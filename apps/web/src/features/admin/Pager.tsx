import { PAGE_SIZE } from "./adminApi";

/** Paginação por deslocamento ("mais recentes" / "mais antigos") com o intervalo mostrado. */
export function Pager({
  offset,
  count,
  total,
  onChange,
}: {
  offset: number;
  count: number;
  total: number;
  onChange: (offset: number) => void;
}) {
  const from = count === 0 ? 0 : offset + 1;
  const to = offset + count;
  return (
    <div className="admin-pager">
      <p className="muted" aria-live="polite">
        {from}–{to} de {total}
      </p>
      <div className="admin-actions">
        <button type="button" className="btn" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - PAGE_SIZE))}>
          Mais recentes
        </button>
        <button type="button" className="btn" disabled={to >= total} onClick={() => onChange(offset + PAGE_SIZE)}>
          Mais antigas
        </button>
      </div>
    </div>
  );
}
