import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PLANILHA_DEFAULTS } from "./planDefaults";
import { fakePlanApi, renderPlan } from "./testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const summary = () => screen.findByRole("region", { name: "Resumo · Amortizar agora" });

describe("resumo e aviso D14", () => {
  it("mostra quitação, juros pagos, juros economizados e quanto custa cada mês de espera", async () => {
    fakePlanApi();
    renderPlan();
    const box = await summary();
    expect(within(box).getByText("abril de 2027")).toBeTruthy();
    expect(within(box).getByText("R$ 1.428,87")).toBeTruthy();
    expect(within(box).getByText("R$ 9.278,76")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toBe(
      "Cada mês sem amortizar os R$ 8.000,00 custa cerca de R$ 276,00 de juros.",
    );
  });

  it("alterna para sem amortizar: resumo e lista mudam, sem quitação no período", async () => {
    fakePlanApi();
    renderPlan();
    await summary();
    fireEvent.click(screen.getByRole("button", { name: "Sem amortizar" }));
    const box = await screen.findByRole("region", { name: "Resumo · Sem amortizar" });
    expect(within(box).getByText("Não quita no período")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sem amortizar" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("compara os dois cenários lado a lado com prazo, juros e saldo", async () => {
    fakePlanApi();
    renderPlan();
    const table = await screen.findByRole("table");
    const row = (name: string) => within(table).getByRole("rowheader", { name }).closest("tr")!;
    const cells = (name: string) => within(row(name)).getAllByRole("cell").map((c) => c.textContent);
    expect(cells("Quitação")).toEqual(["abril de 2027", "Não quita no período"]);
    expect(cells("Juros em 2 meses")).toEqual(["R$ 1.428,87", "R$ 8.017,69"]);
    expect(cells("Saldo devedor no fim")).toEqual(["R$ 8.565,26", "R$ 20.773,36"]);
    expect(screen.getByText(/Amortizando agora, saem R\$ 6\.588,82 a menos de juros/)).toBeTruthy();
  });
});

describe("mês a mês", () => {
  it("mostra entradas, saídas, amortização, saldo devedor e caixa em cada mês", async () => {
    fakePlanApi();
    renderPlan();
    await summary();
    const items = screen.getAllByRole("listitem");
    const first = items.find((li) => within(li).queryByRole("heading", { name: "dezembro de 2026" }));
    expect(first).toBeTruthy();
    const scoped = within(first!);
    expect(scoped.getByText("Entradas")).toBeTruthy();
    expect(scoped.getByText("R$ 10.300,00")).toBeTruthy();
    expect(scoped.getByText("Saídas")).toBeTruthy();
    expect(scoped.getByText("R$ 8.826,33")).toBeTruthy();
    expect(scoped.getByText("R$ 2.098,67")).toBeTruthy(); // amortização do mês
    expect(scoped.getByText("R$ 11.021,51")).toBeTruthy(); // saldo devedor do fim do mês
    expect(scoped.getByText("R$ 2.000,00")).toBeTruthy(); // caixa do fim do mês
  });
});

describe("estados de carregamento e erro", () => {
  it("mostra o erro com botão de tentar de novo", async () => {
    fakePlanApi({ failProjection: true });
    renderPlan();
    expect((await screen.findByRole("alert")).textContent).toContain("Não foi possível carregar o Plano.");
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
  });

  it("mostra carregamento antes dos dados", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    renderPlan();
    expect(screen.getByRole("status").textContent).toContain("Carregando o Plano…");
  });
});

describe("editar premissas", () => {
  it("salva com PUT, converte R$ e % sem float e recarrega a projeção", async () => {
    const api = fakePlanApi();
    renderPlan();
    await summary();
    fireEvent.click(screen.getByRole("button", { name: "Editar premissas" }));

    fireEvent.change(screen.getByLabelText("Salário líquido da Ruth (R$)"), {
      target: { value: "3.500,50" },
    });
    fireEvent.change(screen.getByLabelText("Juros ao mês (%)"), { target: { value: "2,9" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar premissas" }));

    await waitFor(() => expect(api.puts()).toHaveLength(1));
    const body = api.puts()[0];
    expect(body.salary_cents).toBe(350050);
    expect(body.loan_monthly_rate).toBe("0.029");
    expect(body.card_installments).toHaveLength(4);
    expect(body.start_month).toBe("2026-12-01");
    await waitFor(() => expect(api.projectionCalls()["amortize_now"]).toBe(2));
  });

  it("valor inválido mostra o erro no campo e não chama o PUT", async () => {
    const api = fakePlanApi();
    renderPlan();
    await summary();
    fireEvent.click(screen.getByRole("button", { name: "Editar premissas" }));
    fireEvent.change(screen.getByLabelText("Valor contratado (R$)"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar premissas" }));

    expect(await screen.findByText(/Informe em reais/)).toBeTruthy();
    expect(screen.getByLabelText("Valor contratado (R$)").getAttribute("aria-invalid")).toBe("true");
    expect(api.puts()).toHaveLength(0);
  });

  it("a API recusar (422) mostra aviso geral", async () => {
    fakePlanApi({ putStatus: 422 });
    renderPlan();
    await summary();
    fireEvent.click(screen.getByRole("button", { name: "Editar premissas" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar premissas" }));
    expect(await screen.findByText(/A API recusou algum valor/)).toBeTruthy();
  });

  it("adiciona e remove parcelas de cartão", async () => {
    fakePlanApi();
    renderPlan();
    await summary();
    fireEvent.click(screen.getByRole("button", { name: "Editar premissas" }));
    expect(screen.getAllByRole("group", { name: /^Parcela \d$/ })).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "Adicionar parcela de cartão" }));
    expect(screen.getAllByRole("group", { name: /^Parcela \d$/ })).toHaveLength(5);

    fireEvent.click(screen.getByRole("button", { name: "Remover parcela 5" }));
    expect(screen.getAllByRole("group", { name: /^Parcela \d$/ })).toHaveLength(4);
  });

  it("voltar aos valores da planilha pede confirmação antes de gravar", async () => {
    const api = fakePlanApi({
      assumptions: { ...PLANILHA_DEFAULTS, salary_cents: 1 },
    });
    renderPlan();
    await summary();
    fireEvent.click(screen.getByRole("button", { name: "Editar premissas" }));

    fireEvent.click(screen.getByRole("button", { name: "Voltar aos valores da planilha" }));
    expect(api.puts()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Não, manter as premissas atuais" }));
    expect(api.puts()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Voltar aos valores da planilha" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, voltar aos valores da planilha" }));
    await waitFor(() => expect(api.puts()).toHaveLength(1));
    expect(api.puts()[0]).toEqual(PLANILHA_DEFAULTS);
  });
});
