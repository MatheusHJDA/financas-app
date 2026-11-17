import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, EmptyState, ErrorState, LoadingState, Sheet } from "../../ui";
import { useAllCategories } from "../accounts/queries";
import type { Category } from "../accounts/shared";
import { useCategoryMutations } from "./api";
import { CategorySheet, modeTitle, type CategoryMode } from "./CategorySheet";
import "./categories.css";

const GROUPS = [
  { kind: "income", title: "Receitas" },
  { kind: "expense", title: "Despesas" },
] as const;

const byName = (a: Category, b: Category) => a.name.localeCompare(b.name, "pt-BR");

// Tela de Categorias: o casal inclui, renomeia e exclui (o servidor recusa excluir categoria em uso).
export default function CategoriesPage() {
  const categories = useAllCategories();
  const { create, rename, remove } = useCategoryMutations();
  const [mode, setMode] = useState<CategoryMode | null>(null);
  const [notice, setNotice] = useState("");

  const open = (next: CategoryMode) => {
    create.reset();
    rename.reset();
    remove.reset();
    setNotice("");
    setMode(next);
  };
  const close = () => setMode(null);
  const done = (text: string) => ({
    onSuccess: () => {
      setMode(null);
      setNotice(text);
    },
  });

  const mutations = {
    create: { ...create, mutate: (v: Parameters<typeof create.mutate>[0]) => create.mutate(v, done("Categoria criada.")) },
    rename: { ...rename, mutate: (v: Parameters<typeof rename.mutate>[0]) => rename.mutate(v, done("Categoria renomeada.")) },
    remove: { ...remove, mutate: (v: number) => remove.mutate(v, done("Categoria excluída.")) },
  };

  return (
    <section className="cat-page">
      <div className="cat-head">
        <h1>Categorias</h1>
        {categories.data ? (
          <Button variant="primary" icon={Plus} onClick={() => open({ kind: "new" })}>
            Nova categoria
          </Button>
        ) : null}
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">
        {notice}
      </p>

      {categories.isLoading ? <LoadingState label="Carregando categorias…" /> : null}
      {categories.isError ? (
        <ErrorState message="Não foi possível carregar as categorias." onRetry={() => void categories.refetch()} />
      ) : null}
      {categories.data && categories.data.length === 0 ? (
        <EmptyState title="Nenhuma categoria ainda" hint="Crie uma categoria para classificar os lançamentos." />
      ) : null}

      {categories.data && categories.data.length > 0
        ? GROUPS.map((g) => {
            const items = categories.data.filter((c) => c.kind === g.kind).sort(byName);
            return (
              <div key={g.kind} className="cat-group">
                <h2>{g.title}</h2>
                {items.length === 0 ? (
                  <p className="muted">Nenhuma categoria.</p>
                ) : (
                  <ul className="cat-list" aria-label={g.title}>
                    {items.map((c) => (
                      <li key={c.id} className="cat-row">
                        <span className="cat-row__name">{c.name}</span>
                        <span className="cat-row__actions">
                          <Button className="cat-row__btn" icon={Pencil} aria-label={`Renomear ${c.name}`} onClick={() => open({ kind: "rename", category: c })}>
                            <span className="cat-row__label">Renomear</span>
                          </Button>
                          <Button variant="danger" className="cat-row__btn" icon={Trash2} aria-label={`Excluir ${c.name}`} onClick={() => open({ kind: "delete", category: c })}>
                            <span className="cat-row__label">Excluir</span>
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })
        : null}

      <Sheet open={mode !== null} title={mode ? modeTitle(mode) : ""} onClose={close}>
        {mode ? <CategorySheet mode={mode} {...mutations} onClose={close} /> : null}
      </Sheet>
    </section>
  );
}
