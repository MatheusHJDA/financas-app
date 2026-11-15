import { Button } from "../../ui";
import { PAGE_SIZE } from "./adminApi";

/** Paginação por deslocamento ("mais recentes" / "mais antigas") com o intervalo mostrado. */
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
        <Button disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - PAGE_SIZE))}>
          Mais recentes
        </Button>
        <Button disabled={to >= total} onClick={() => onChange(offset + PAGE_SIZE)}>
          Mais antigas
        </Button>
      </div>
    </div>
  );
}
