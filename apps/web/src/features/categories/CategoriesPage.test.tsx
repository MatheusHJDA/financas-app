import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { bodyOf, MATHEUS, renderApp, RUTH } from "../../test/appTesting";
import CategoriesPage from "./CategoriesPage";
import { makeCategoriesServer } from "./testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const btn = (name: string) => screen.getByRole("button", { name });

async function openAs(me = MATHEUS, opts: Parameters<typeof makeCategoriesServer>[1] = {}) {
  const server = makeCategoriesServer(me, opts);
  const view = renderApp(<CategoriesPage />);
  await screen.findByText("Mercado");
  return { ...server, ...view };
}

it("lista Receitas e Despesas com as categorias de cada tipo", async () => {
  await openAs();
  const receitas = screen.getByRole("list", { name: "Receitas" });
  expect(within(receitas).getByText("Salário")).toBeTruthy();
  expect(within(receitas).getByText("Uber")).toBeTruthy();
  expect(within(receitas).queryByText("Mercado")).toBeNull();
  const despesas = screen.getByRole("list", { name: "Despesas" });
  expect(within(despesas).getByText("Mercado")).toBeTruthy();
  expect(within(despesas).getByText("Energia elétrica")).toBeTruthy();
});

it("Nova categoria envia nome e tipo e a nova aparece", async () => {
  const { calls } = await openAs();
  fireEvent.click(btn("Nova categoria"));
  fireEvent.change(await screen.findByLabelText("Nome"), { target: { value: "Pets" } });
  fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "expense" } });
  fireEvent.click(btn("Criar categoria"));
  await waitFor(() => expect(calls.some((c) => c.key === "POST /categories")).toBe(true));
  expect(await bodyOf(calls, "POST /categories")).toEqual({ name: "Pets", kind: "expense", is_recurring_card_allowed: false });
  expect(await screen.findByText("Pets")).toBeTruthy();
});

it("Renomear faz PATCH só com name", async () => {
  const { calls } = await openAs();
  fireEvent.click(btn("Renomear Mercado"));
  const input = (await screen.findByLabelText("Nome")) as HTMLInputElement;
  expect(input.value).toBe("Mercado");
  expect(screen.queryByLabelText("Tipo")).toBeNull();
  fireEvent.change(input, { target: { value: "Supermercado" } });
  fireEvent.click(btn("Salvar"));
  await waitFor(() => expect(calls.some((c) => c.key === "PATCH /categories/10")).toBe(true));
  expect(await bodyOf(calls, "PATCH /categories/10")).toEqual({ name: "Supermercado" });
  expect(await screen.findByText("Supermercado")).toBeTruthy();
});

it("Excluir pede confirmação e só então faz DELETE", async () => {
  const { calls } = await openAs();
  fireEvent.click(btn("Excluir Mercado"));
  expect(await screen.findByText("Excluir a categoria Mercado?")).toBeTruthy();
  expect(calls.some((c) => c.key === "DELETE /categories/10")).toBe(false);
  fireEvent.click(btn("Sim, excluir"));
  await waitFor(() => expect(calls.some((c) => c.key === "DELETE /categories/10")).toBe(true));
  await waitFor(() => expect(screen.queryByText("Mercado")).toBeNull());
});

it("409 mostra que a categoria está em uso", async () => {
  await openAs(MATHEUS, { deleteConflict: true });
  fireEvent.click(btn("Excluir Mercado"));
  fireEvent.click(await screen.findByRole("button", { name: "Sim, excluir" }));
  expect(
    await screen.findByText("Essa categoria está em uso em lançamentos, contas fixas ou metas e não pode ser excluída."),
  ).toBeTruthy();
});

it("nome vazio ou acima do limite mostra erro sem chamar a API", async () => {
  const { calls } = await openAs();
  fireEvent.click(btn("Nova categoria"));
  const input = await screen.findByLabelText("Nome");
  fireEvent.click(btn("Criar categoria"));
  expect(await screen.findByText("Informe o nome da categoria.")).toBeTruthy();
  fireEvent.change(input, { target: { value: "a".repeat(121) } });
  fireEvent.click(btn("Criar categoria"));
  expect(await screen.findByText("O nome pode ter no máximo 120 caracteres.")).toBeTruthy();
  expect(calls.some((c) => c.key === "POST /categories")).toBe(false);
});

it("Ruth (membro) também cria, renomeia e exclui", async () => {
  await openAs(RUTH);
  expect(btn("Nova categoria")).toBeTruthy();
  expect(btn("Renomear Mercado")).toBeTruthy();
  expect(btn("Excluir Mercado")).toBeTruthy();
});
