import { useId, useState, type FormEvent } from "react";
import { Button } from "../../ui";
import { ConfirmBar } from "../accounts/ConfirmBar";
import { ApiError, errorMessage, type Category } from "../accounts/shared";
import { NAME_MAX, type CategoryKind } from "./api";
import "../accounts/ui.css";

interface Mutation<T> {
  mutate: (input: T) => void;
  isPending: boolean;
  isError: boolean;
  error: unknown;
}

export type CategoryMode = { kind: "new" } | { kind: "rename" | "delete"; category: Category };

export const IN_USE = "Essa categoria está em uso em lançamentos, contas fixas ou metas e não pode ser excluída.";
const FORBIDDEN = "Você não pode alterar categorias.";

export function modeTitle(mode: CategoryMode): string {
  if (mode.kind === "new") return "Nova categoria";
  return mode.kind === "rename" ? "Renomear categoria" : "Excluir categoria";
}

interface Props {
  mode: CategoryMode;
  create: Mutation<{ name: string; kind: CategoryKind }>;
  rename: Mutation<{ id: number; name: string }>;
  remove: Mutation<number>;
  onClose: () => void;
}

export function CategorySheet({ mode, create, rename, remove, onClose }: Props) {
  if (mode.kind === "delete") {
    const { category } = mode;
    const conflict = remove.error instanceof ApiError && remove.error.status === 409;
    return (
      <ConfirmBar
        message={`Excluir a categoria ${category.name}?`}
        confirmLabel="Sim, excluir"
        danger
        busy={remove.isPending}
        error={remove.isError ? (conflict ? IN_USE : errorMessage(remove.error, FORBIDDEN)) : null}
        retryable={!conflict}
        onConfirm={() => remove.mutate(category.id)}
        onCancel={onClose}
      />
    );
  }
  const category = mode.kind === "rename" ? mode.category : null;
  const mutation = category ? rename : create;
  return (
    <NameForm
      initialName={category?.name ?? ""}
      askKind={!category}
      busy={mutation.isPending}
      serverError={mutation.isError ? errorMessage(mutation.error, FORBIDDEN) : null}
      submitLabel={category ? "Salvar" : "Criar categoria"}
      onSubmit={(name, kind) => (category ? rename.mutate({ id: category.id, name }) : create.mutate({ name, kind }))}
      onCancel={onClose}
    />
  );
}

interface FormProps {
  initialName: string;
  askKind: boolean;
  busy: boolean;
  serverError: string | null;
  submitLabel: string;
  onSubmit: (name: string, kind: CategoryKind) => void;
  onCancel: () => void;
}

function NameForm({ initialName, askKind, busy, serverError, submitLabel, onSubmit, onCancel }: FormProps) {
  const uid = useId();
  const [name, setName] = useState(initialName);
  const [kind, setKind] = useState<CategoryKind>("expense");
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return setProblem("Informe o nome da categoria.");
    if (clean.length > NAME_MAX) return setProblem(`O nome pode ter no máximo ${NAME_MAX} caracteres.`);
    setProblem(null);
    onSubmit(clean, kind);
  };

  return (
    <form className="u8-form" onSubmit={submit} noValidate>
      <div className="u8-field">
        <label htmlFor={`${uid}-name`}>Nome</label>
        <input
          id={`${uid}-name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          aria-invalid={problem ? true : undefined}
        />
      </div>
      {askKind ? (
        <div className="u8-field">
          <label htmlFor={`${uid}-kind`}>Tipo</label>
          <select id={`${uid}-kind`} value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)}>
            <option value="expense">Despesa</option>
            <option value="income">Receita</option>
          </select>
        </div>
      ) : null}
      {problem || serverError ? (
        <p className="u8-err" role="alert">
          {problem ?? serverError}
        </p>
      ) : null}
      <div className="u8-actions">
        <Button variant="primary" type="submit" disabled={busy}>
          {submitLabel}
        </Button>
        <Button onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
