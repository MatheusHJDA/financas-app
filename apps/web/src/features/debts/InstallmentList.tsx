import { Money } from "../../ui";
import type { Installment } from "./api";

const MONTHS = ["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];

/** "2026-12-18" -> "18 dez. 2026". */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso;
}

/** "2026-11-17" -> "17/11". */
function shortDate(iso: string | null): string {
  const m = iso ? /^\d{4}-(\d{2})-(\d{2})$/.exec(iso) : null;
  return m ? `${m[2]}/${m[1]}` : "";
}

interface Props {
  items: Installment[];
  selected: ReadonlySet<number>;
  onToggle: (id: number) => void;
}

/** Abertas primeiro (com caixa de seleção), pagas e adiantadas no fim (com selo e sem caixa). */
export function InstallmentList({ items, selected, onToggle }: Props) {
  const open = items.filter((i) => i.status === "open");
  const done = items.filter((i) => i.status !== "open");
  return (
    <ul className="loan-list" aria-label="Parcelas">
      {open.map((i) => {
        const saves = (i.savings_cents ?? 0) > 0;
        return (
          <li key={i.id} className="loan-row">
            <label className="loan-row__label">
              <input
                type="checkbox"
                checked={selected.has(i.id)}
                onChange={() => onToggle(i.id)}
                aria-label={`Selecionar ${i.number}ª parcela`}
              />
              <span className="loan-row__text">
                <span className="loan-row__title">
                  {i.number}ª · {longDate(i.due_date)}
                </span>
                {saves ? (
                  <span className="loan-row__save">
                    economiza <Money cents={i.savings_cents ?? 0} />
                  </span>
                ) : null}
              </span>
              <span className="loan-row__values">
                <Money cents={i.today_cents ?? i.face_cents} className="loan-row__today" />
                {saves ? (
                  <s className="loan-row__face">
                    <Money cents={i.face_cents} />
                  </s>
                ) : null}
              </span>
            </label>
          </li>
        );
      })}
      {done.map((i) => (
        <li key={i.id} className="loan-row loan-row--done">
          <div className="loan-row__label">
            <span className="loan-row__text">
              <span className="loan-row__title">
                {i.number}ª · {longDate(i.due_date)}
              </span>
              <span className="loan-badge">
                {i.status === "prepaid" ? "Adiantada" : "Paga"} em {shortDate(i.paid_on)}
              </span>
            </span>
            <span className="loan-row__values">
              <Money cents={i.paid_cents ?? i.face_cents} className="loan-row__today" />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
