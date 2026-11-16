import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { todayIso } from "../chat/dates";
import { bodyOf, json, makeServer, MATHEUS, renderApp, RUTH, writes } from "../../test/appTesting";
import { HideValuesProvider } from "../../ui";
import GoalsPage from "./GoalsPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const card = (name: string) => screen.getByRole("listitem", { name });
const btn = (label: string) => screen.queryByRole("button", { name: label });
/** Parágrafo cujo texto inteiro (somando os spans do Money) é `text`. */
const para = (text: string) => (_: string, el: Element | null) => el?.tagName === "P" && el.textContent === text;

async function openAs(me: typeof RUTH, overrides = {}) {
  const server = makeServer(me, overrides);
  renderApp(<GoalsPage />);
  await screen.findByText("Reserva de emergência");
  return server;
}

it("mostra o progresso de cada tipo de meta (barra + texto)", async () => {
  await openAs(RUTH);

  const reserva = card("Reserva de emergência");
  expect(within(reserva).getByText(para("R$ 1.200 de R$ 5.000 · 24%"))).toBeTruthy();
  expect(within(reserva).getByRole("progressbar").getAttribute("aria-valuetext")).toBe("R$ 1.200 de R$ 5.000 · 24%");
  expect(within(reserva).getByText(/Acumular valor · Ambos · Prazo 30\/06\/2027/)).toBeTruthy();
  const bar = within(reserva).getByRole("progressbar", { name: "Progresso de Reserva de emergência" });
  expect(bar.getAttribute("aria-valuenow")).toBe("24");

  const uber = card("Uber diário");
  expect(within(uber).getByText(para("R$ 110 de R$ 130 · 84,6%"))).toBeTruthy();
  expect(await within(uber).findByText(/Receita por período · Matheus · Diária · Uber/)).toBeTruthy();
  expect(within(uber).getByText("Nível atingido: Piso")).toBeTruthy();
  const levels = within(uber).getByRole("list", { name: "Níveis" });
  expect(within(levels).getByText(/Piso/).textContent).toContain("✓");
  expect(within(levels).getByText("Meta").textContent).not.toContain("✓");
  expect(within(levels).getByText("Desafio")).toBeTruthy();
  expect(within(levels).getByText("R$ 160")).toBeTruthy();

  const ifood = card("iFood do mês");
  expect(within(ifood).getByText(para("R$ 520 de R$ 400 · 130%"))).toBeTruthy();
  expect(within(ifood).getByText(para("Acima do teto em R$ 120."))).toBeTruthy();
  expect(within(ifood).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100"); // barra limitada a 100%

  const debt = card("Quitar empréstimo");
  expect(within(debt).getByText(para("R$ 2.500 de R$ 10.000 · 25%"))).toBeTruthy();
  expect(within(debt).getByText("Quanto da dívida já foi quitado.")).toBeTruthy();
});

it("Ruth: editar/excluir só nas metas dela e nas AMBOS; Matheus (admin) vê em todas", async () => {
  await openAs(RUTH);
  await waitFor(() => expect(btn("Editar meta iFood do mês")).toBeTruthy());
  expect(btn("Excluir meta iFood do mês")).toBeTruthy();
  expect(btn("Editar meta Reserva de emergência")).toBeTruthy();
  expect(btn("Editar meta Uber diário")).toBeNull();
  expect(btn("Excluir meta Quitar empréstimo")).toBeNull();
  cleanup();

  await openAs(MATHEUS);
  await waitFor(() => expect(btn("Editar meta Uber diário")).toBeTruthy());
  for (const name of ["Reserva de emergência", "Uber diário", "iFood do mês", "Quitar empréstimo"]) {
    expect(btn(`Editar meta ${name}`)).toBeTruthy();
    expect(btn(`Excluir meta ${name}`)).toBeTruthy();
  }
});

it("aporte manual só em meta de acumular sem conta vinculada", async () => {
  const { calls } = await openAs(MATHEUS);
  await waitFor(() => expect(btn("Registrar aporte em Reserva de emergência")).toBeTruthy());
  expect(btn("Registrar aporte em Uber diário")).toBeNull();
  expect(btn("Registrar aporte em iFood do mês")).toBeNull();

  fireEvent.click(btn("Registrar aporte em Reserva de emergência")!);
  fireEvent.change(screen.getByLabelText("Valor do aporte (R$)"), { target: { value: "200,00" } });
  fireEvent.click(screen.getByRole("button", { name: "Registrar aporte" }));

  await waitFor(() => expect(writes(calls)).toEqual(["POST /goals/1/entries"]));
  expect(await bodyOf(calls, "POST /goals/1/entries")).toEqual({ amount_cents: 20_000, date: todayIso() });
  // o servidor simulado soma o aporte; a lista é recarregada
  expect(await within(card("Reserva de emergência")).findByText(para("R$ 1.400 de R$ 5.000 · 28%"))).toBeTruthy();
});

it("aporte inválido não chama a API", async () => {
  const { calls } = await openAs(MATHEUS);
  await waitFor(() => expect(btn("Registrar aporte em Reserva de emergência")).toBeTruthy());
  fireEvent.click(btn("Registrar aporte em Reserva de emergência")!);
  fireEvent.click(screen.getByRole("button", { name: "Registrar aporte" }));
  expect(await screen.findByText(/Informe um valor maior que zero/)).toBeTruthy();
  expect(writes(calls)).toEqual([]);
});

it("meta com conta vinculada explica que o progresso vem do saldo", async () => {
  makeServer(MATHEUS, {
    "GET /goals": () =>
      json({
        items: [
          {
            id: 9,
            owner: "AMBOS",
            type: "accumulate",
            name: "Viagem",
            target_cents: 100_000,
            linked_account_id: 3,
            active: true,
            progress: { current_cents: 500_000, target_cents: 100_000, percent: 500, level: null },
          },
        ],
        total: 1,
      }),
  });
  renderApp(<GoalsPage />);
  const viagem = await screen.findByRole("listitem", { name: "Viagem" });
  expect(within(viagem).getByText("O progresso vem do saldo da conta vinculada.")).toBeTruthy();
  expect(await within(viagem).findByText(/Conta Reserva casal/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Registrar aporte em Viagem" })).toBeNull();
});

it("criar meta de receita por período manda níveis e valores em centavos", async () => {
  const { calls } = await openAs(MATHEUS);
  fireEvent.click(await screen.findByRole("button", { name: "Nova meta" }));
  fireEvent.change(screen.getByLabelText("Tipo da meta"), { target: { value: "income_period" } });
  fireEvent.change(screen.getByLabelText("Nome da meta"), { target: { value: "Uber semanal" } });
  fireEvent.change(screen.getByLabelText("Período"), { target: { value: "weekly" } });
  fireEvent.change(screen.getByLabelText("Piso (R$, opcional)"), { target: { value: "500" } });
  fireEvent.change(screen.getByLabelText("Meta (R$)"), { target: { value: "650,50" } });
  fireEvent.change(screen.getByLabelText("Desafio (R$, opcional)"), { target: { value: "800" } });
  fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "15" } });
  fireEvent.click(screen.getByRole("button", { name: "Criar meta" }));

  await waitFor(() => expect(writes(calls)).toEqual(["POST /goals"]));
  expect(await bodyOf(calls, "POST /goals")).toEqual({
    owner: "MATHEUS",
    type: "income_period",
    name: "Uber semanal",
    target_cents: 65_050,
    period: "weekly",
    levels: [
      { name: "Piso", target_cents: 50_000 },
      { name: "Meta", target_cents: 65_050 },
      { name: "Desafio", target_cents: 80_000 },
    ],
    due_date: null,
    linked_account_id: null,
    linked_category_id: 15,
    active: true,
  });
  expect(await screen.findByText("Uber semanal")).toBeTruthy();
});

it("formulário de meta mostra erros por campo e não grava", async () => {
  const { calls } = await openAs(RUTH);
  fireEvent.click(await screen.findByRole("button", { name: "Nova meta" }));
  fireEvent.click(screen.getByRole("button", { name: "Criar meta" }));
  expect(await screen.findByText("Informe o nome da meta.")).toBeTruthy();
  expect(screen.getByText(/Informe um valor maior que zero/)).toBeTruthy();
  expect(writes(calls)).toEqual([]);
});

it("edita uma meta (PATCH) e trata 403 do servidor", async () => {
  const { calls } = await openAs(RUTH);
  await waitFor(() => expect(btn("Editar meta iFood do mês")).toBeTruthy());
  fireEvent.click(btn("Editar meta iFood do mês")!);
  const target = screen.getByLabelText("Teto mensal (R$)") as HTMLInputElement;
  expect(target.value).toBe("400,00");
  fireEvent.change(target, { target: { value: "1.234,56" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar meta" }));
  await waitFor(() => expect(writes(calls)).toEqual(["PATCH /goals/3"]));
  expect((await bodyOf(calls, "PATCH /goals/3")).target_cents).toBe(123_456);
  cleanup();

  makeServer(RUTH, { "PATCH /goals/:id": () => json({ detail: "x" }, 403) });
  renderApp(<GoalsPage />);
  await waitFor(() => expect(btn("Editar meta iFood do mês")).toBeTruthy());
  fireEvent.click(btn("Editar meta iFood do mês")!);
  fireEvent.click(screen.getByRole("button", { name: "Salvar meta" }));
  expect(await screen.findByText("Você não pode alterar essa meta.")).toBeTruthy();
});

it("excluir meta só grava depois da confirmação", async () => {
  const { calls } = await openAs(RUTH);
  await waitFor(() => expect(btn("Excluir meta iFood do mês")).toBeTruthy());
  fireEvent.click(btn("Excluir meta iFood do mês")!);
  expect(screen.getByText('Excluir a meta "iFood do mês"?')).toBeTruthy();
  expect(writes(calls)).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(writes(calls)).toEqual([]);

  fireEvent.click(btn("Excluir meta iFood do mês")!);
  fireEvent.click(screen.getByRole("button", { name: "Sim, excluir" }));
  await waitFor(() => expect(writes(calls)).toEqual(["DELETE /goals/3"]));
  await waitFor(() => expect(screen.queryByText("iFood do mês")).toBeNull());
});

it("excluir: o foco vai para Cancelar ao abrir e volta ao botão Excluir ao cancelar", async () => {
  await openAs(RUTH);
  await waitFor(() => expect(btn("Excluir meta iFood do mês")).toBeTruthy());
  fireEvent.click(btn("Excluir meta iFood do mês")!);
  const cancelar = within(card("iFood do mês")).getByRole("button", { name: "Cancelar" });
  expect(document.activeElement).toBe(cancelar);
  fireEvent.click(cancelar);
  expect(document.activeElement).toBe(btn("Excluir meta iFood do mês"));
});

it("editar e aportar: o foco vai ao primeiro campo e volta ao botão ao cancelar", async () => {
  await openAs(MATHEUS);
  await waitFor(() => expect(btn("Registrar aporte em Reserva de emergência")).toBeTruthy());
  fireEvent.click(btn("Registrar aporte em Reserva de emergência")!);
  expect(document.activeElement).toBe(screen.getByLabelText("Valor do aporte (R$)"));
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(document.activeElement).toBe(btn("Registrar aporte em Reserva de emergência"));

  fireEvent.click(btn("Editar meta iFood do mês")!);
  const form = within(card("iFood do mês")).getByRole("form");
  expect(form.contains(document.activeElement)).toBe(true);
  fireEvent.click(within(form).getByRole("button", { name: "Cancelar" }));
  expect(document.activeElement).toBe(btn("Editar meta iFood do mês"));
});

it("teto estourado aparece em texto e o valor passa pelo Money (leitor diz 'Valor oculto')", async () => {
  localStorage.setItem("finance.hideValues", "1");
  try {
    makeServer(MATHEUS);
    renderApp(
      <HideValuesProvider>
        <GoalsPage />
      </HideValuesProvider>,
    );
    await screen.findByText("Reserva de emergência");
    const ifood = card("iFood do mês");
    expect(within(ifood).getByText(/Acima do teto/).textContent).toContain("•••••");
    expect(within(ifood).getAllByRole("img", { name: "Valor oculto" }).length).toBeGreaterThanOrEqual(3);
    const bar = within(ifood).getByRole("progressbar");
    expect(bar.getAttribute("aria-valuetext")).not.toMatch(/R\$|•/);
    expect(bar.getAttribute("aria-valuetext")).toContain("valor oculto");
  } finally {
    localStorage.removeItem("finance.hideValues");
  }
});

it("estados de vazio e de erro", async () => {
  makeServer(RUTH, { "GET /goals": () => json({ items: [], total: 0 }) });
  renderApp(<GoalsPage />);
  expect(await screen.findByText("Nenhuma meta ainda")).toBeTruthy();
  cleanup();

  makeServer(RUTH, { "GET /goals": () => json({ detail: "falha" }, 500) });
  renderApp(<GoalsPage />);
  expect(await screen.findByText("Não foi possível carregar as metas.")).toBeTruthy();
});

it("mostra esqueleto com a forma dos cartões enquanto carrega", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  renderApp(<GoalsPage />);
  const loading = screen.getByRole("status", { name: "Carregando metas…" });
  expect(loading.getAttribute("aria-busy")).toBe("true");
  expect(screen.getByRole("heading", { name: "Metas", level: 1 })).toBeTruthy();
});

it("meta inativa ganha o selo 'Inativa' e a barra de teto estourado fica marcada", async () => {
  makeServer(MATHEUS, {
    "GET /goals": () =>
      json({
        items: [
          {
            id: 7,
            owner: "AMBOS",
            type: "category_cap",
            name: "Lazer",
            target_cents: 40_000,
            active: false,
            progress: { current_cents: 52_000, target_cents: 40_000, percent: 130, level: null },
          },
        ],
        total: 1,
      }),
  });
  renderApp(<GoalsPage />);
  const lazer = await screen.findByRole("listitem", { name: "Lazer" });
  expect(within(lazer).getByText("Inativa")).toBeTruthy();
  expect(within(lazer).getByRole("progressbar").className).toContain("goal-bar--over");
});

it("'Nova meta' abre o formulário e 'Cancelar' volta ao botão", async () => {
  await openAs(MATHEUS);
  fireEvent.click(await screen.findByRole("button", { name: "Nova meta" }));
  expect(screen.getByRole("form", { name: "Nova meta" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Nova meta" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(screen.getByRole("button", { name: "Nova meta" })).toBeTruthy();
});

it("olho ligado oculta os valores das metas (progresso, níveis e teto estourado)", async () => {
  localStorage.setItem("finance.hideValues", "1");
  try {
    makeServer(MATHEUS);
    renderApp(
      <HideValuesProvider>
        <GoalsPage />
      </HideValuesProvider>,
    );
    await screen.findByText("Reserva de emergência");
    const list = screen.getByRole("list", { name: "Metas" });
    expect(within(list).queryByText(/R\$ \d/)).toBeNull();
    expect(within(list).getAllByText(/R\$ •••••/).length).toBeGreaterThan(0);
  } finally {
    localStorage.removeItem("finance.hideValues");
  }
});
