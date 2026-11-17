import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../../auth/AuthProvider";
import { afterEach, expect, it, vi } from "vitest";
import { bodyOf, MATHEUS, RUTH } from "../../test/appTesting";
import { AFTER_LOAN_PAID } from "./api";
import LoanPage, { DebtsRedirect } from "./LoanPage";
import { LOAN_DEBT, makeInstallments, makeLoanServer, renderLoan } from "./testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const btn = (name: string | RegExp) => screen.getByRole("button", { name });
/** Elemento cujo texto inteiro (somando os spans do Money) é `text`. */

async function open(opts: Parameters<typeof makeLoanServer>[1] = {}) {
  const server = makeLoanServer(MATHEUS, opts);
  const view = renderLoan(<LoanPage />);
  await screen.findByText("Restante a pagar");
  await screen.findByText(/13ª/);
  return { ...server, ...view };
}

it("mostra restante, total pago e quitar hoje", async () => {
  await open();
  expect(screen.getByText("Restante a pagar").parentElement!.textContent).toContain("R$ 13.000,00");
  expect(screen.getByText("Total pago").parentElement!.textContent).toContain("R$ 2.000,00");
  expect(screen.getByText("Quitar hoje (estimativa)").parentElement!.textContent).toContain("R$ 11.700,00");
});

it("lista 13 parcelas em ordem com valor hoje e economia", async () => {
  await open();
  const rows = screen.getAllByRole("checkbox");
  expect(rows).toHaveLength(13);
  expect(rows[0].getAttribute("aria-label")).toBe("Selecionar 1ª parcela");
  expect(rows[12].getAttribute("aria-label")).toBe("Selecionar 13ª parcela");
  const first = rows[0].closest("li")!;
  expect(first.textContent).toContain("1ª · 18 dez. 2026");
  expect(first.textContent).toContain("R$ 900,00");
  expect(first.textContent).toContain("R$ 1.000,00");
  expect(first.textContent).toContain("economiza R$ 100,00");
  expect(screen.getByText(/13ª · 18 dez. 2027/)).toBeTruthy();
});

it("selecionar 12ª e 13ª mostra total e economia na barra", async () => {
  await open();
  expect(screen.queryByRole("button", { name: "Revisar" })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar 12ª parcela" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar 13ª parcela" }));
  const bar = screen.getByRole("region", { name: "Parcelas selecionadas" });
  expect(bar.textContent).toContain("2 parcelas");
  expect(bar.textContent).toContain("R$ 1.800,00");
  expect(bar.textContent).toContain("Você economiza R$ 200,00");
  expect(within(bar).getByRole("button", { name: "Revisar" })).toBeTruthy();
});

it("confirmar envia installment_ids, amount_cents digitado, account_id e date e invalida AFTER_LOAN_PAID", async () => {
  const { calls, client } = await open();
  const spy = vi.spyOn(client, "invalidateQueries");
  fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar 12ª parcela" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar 13ª parcela" }));
  fireEvent.click(btn("Revisar"));

  const valor = (await screen.findByLabelText("Valor cobrado")) as HTMLInputElement;
  expect(valor.value).toBe("1800,00");
  await waitFor(() => expect((screen.getByLabelText("Conta") as HTMLSelectElement).value).toBe("2")); // conta da conta fixa
  fireEvent.change(valor, { target: { value: "1790,50" } });
  fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-11-17" } });
  fireEvent.click(btn("Confirmar pagamento"));

  await waitFor(() => expect(calls.some((c) => c.key === "POST /debts/7/installments/pay")).toBe(true));
  expect(await bodyOf(calls, "POST /debts/7/installments/pay")).toEqual({
    installment_ids: [112, 113],
    amount_cents: 179_050,
    account_id: 2,
    date: "2026-11-17",
  });
  await waitFor(() => {
    for (const key of AFTER_LOAN_PAID) expect(spy).toHaveBeenCalledWith({ queryKey: [key] });
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(AFTER_LOAN_PAID).toEqual(["debts", "bill-instances", "overview", "transactions", "accounts", "goals", "report"]);
});

it("parcela adiantada aparece com selo e sem caixa", async () => {
  const items = makeInstallments({
    1: { status: "paid", today_cents: null, savings_cents: null, paid_cents: 100_000, paid_on: "2026-11-17" },
    13: { status: "prepaid", today_cents: null, savings_cents: null, paid_cents: 88_000, paid_on: "2026-11-17" },
  });
  makeLoanServer(MATHEUS, { items });
  renderLoan(<LoanPage />);
  await screen.findByText("Adiantada em 17/11");
  expect(screen.getByText("Paga em 17/11")).toBeTruthy();
  expect(screen.getAllByRole("checkbox")).toHaveLength(11);
  const adiantada = screen.getByText("Adiantada em 17/11").closest("li")!;
  expect(adiantada.querySelector("input")).toBeNull();
  expect(adiantada.textContent).toContain("R$ 880,00");
  // pagas ficam no fim, depois das abertas
  const all = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
  expect(all[0]).toContain("2ª");
  expect(all.at(-2)).toContain("1ª");
  expect(all.at(-1)).toContain("13ª");
});

it("olho oculta todos os valores", async () => {
  localStorage.setItem("finance.hideValues", "1");
  await open();
  fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar 12ª parcela" }));
  expect(document.body.textContent).not.toMatch(/R\$\s?\d/);
  expect(screen.getAllByLabelText("Valor oculto").length).toBeGreaterThan(10);
});

it("erro 409 mostra \"Essa parcela já foi paga.\" e recarrega", async () => {
  const { calls } = await open({ payError: { status: 409, detail: "Essa parcela já foi paga." } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar 13ª parcela" }));
  fireEvent.click(btn("Revisar"));
  await screen.findByLabelText("Valor cobrado");
  await waitFor(() => expect((screen.getByLabelText("Conta") as HTMLSelectElement).value).toBe("2")); // contas carregadas
  const before = calls.filter((c) => c.key === "GET /debts/7/installments").length;
  fireEvent.click(btn("Confirmar pagamento"));
  expect((await screen.findByRole("alert")).textContent).toContain("Essa parcela já foi paga.");
  await waitFor(() => expect(calls.filter((c) => c.key === "GET /debts/7/installments").length).toBeGreaterThan(before));
});

it("dívida sem parcelas mostra só o saldo devedor", async () => {
  makeLoanServer(MATHEUS, {
    items: [],
    extra: {
      "GET /debts/:id/installments": async () =>
        new Response(JSON.stringify({ remaining_cents: 800_000, paid_cents: 0, payoff_today_cents: 800_000, items: [] }), {
          headers: { "Content-Type": "application/json" },
        }),
    },
  });
  renderLoan(<LoanPage />);
  expect(await screen.findByText("Esta dívida não tem parcelas cadastradas.")).toBeTruthy();
  expect(screen.getByText("Saldo devedor")).toBeTruthy();
  expect(screen.queryByText("Restante a pagar")).toBeNull();
});

it("/dividas leva à primeira dívida com parcelas", async () => {
  makeLoanServer(MATHEUS);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={["/dividas"]}>
          <Routes>
            <Route path="/dividas" element={<DebtsRedirect />} />
            <Route path="/dividas/:id" element={<p>Tela da dívida</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Tela da dívida")).toBeTruthy();
});

it("só oferece contas que o usuário movimenta (Ruth não vê conta só do Matheus)", async () => {
  makeLoanServer(RUTH, { debt: { ...LOAN_DEBT, owner: "AMBOS" } });
  renderLoan(<LoanPage />);
  await screen.findByText(/13ª/);
  fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar 12ª parcela" }));
  fireEvent.click(btn("Revisar"));
  const select = (await screen.findByLabelText("Conta")) as HTMLSelectElement;
  const labels = () => Array.from(select.options).map((o) => o.textContent ?? "");
  await waitFor(() => expect(labels().some((l) => l.includes("Nubank Ruth"))).toBe(true));
  expect(labels().some((l) => l.includes("Itaú Matheus"))).toBe(false);
  expect(select.value).not.toBe("2"); // a conta padrão da conta fixa é do Matheus
});
