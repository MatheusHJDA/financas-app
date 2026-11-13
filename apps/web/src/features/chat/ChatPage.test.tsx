import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ACCOUNTS,
  CATEGORIES,
  DRAFT_LUZ,
  DRAFT_SEM_CONTA,
  INGEST_ONE,
  INGEST_TWO,
  ME,
  txFrom,
} from "./__fixtures__/ingest";
import type { IngestResult } from "./types";
import { FakeXHR, installFakeXHR, json, mockFetch, renderChat, type Call, type Handler } from "./testing";

let calls: Call[] = [];

function setup(extra: Record<string, Handler> = {}) {
  installFakeXHR();
  calls = mockFetch({
    "GET /auth/me": () => json(ME),
    "GET /accounts": () => json({ items: ACCOUNTS, total: ACCOUNTS.length }),
    "GET /categories": () => json({ items: CATEGORIES, total: CATEGORIES.length }),
    ...extra,
  });
  renderChat();
}

const writes = () => calls.filter((c) => c.req.method !== "GET").map((c) => c.key);
const bodyOf = async (key: string) => JSON.parse(await calls.find((c) => c.key === key)!.req.clone().text());

function write(text: string) {
  fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: text } });
}

function pickFile(label: RegExp, file: File) {
  fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
}

async function submitAndRespond(status: number, body: unknown) {
  await waitFor(() => expect(FakeXHR.instances.length).toBeGreaterThan(0));
  const xhr = FakeXHR.instances[FakeXHR.instances.length - 1];
  act(() => xhr.respond(status, body));
  return xhr;
}

const card = (name: RegExp | string) => screen.getByRole("article", { name });

beforeEach(() => {
  vi.stubGlobal("navigator", { ...navigator, userAgent: "Mozilla/5.0 (Android 13)" });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("texto: mostra cartões, não grava nada sem toque, edita e confirma a proposta editada", async () => {
  setup({
    "POST /drafts/101/confirm": (req) => req.clone().json().then((b) => json({ ...txFrom(INGEST_TWO.drafts[0], 900), ...b, id: 900 })),
  });

  write("mercado 45,90 no Nubank");
  fireEvent.keyDown(screen.getByLabelText("Mensagem"), { key: "Enter" });
  const xhr = await submitAndRespond(200, INGEST_TWO);
  expect(xhr.body?.get("text")).toBe("mercado 45,90 no Nubank");

  // cartões: valor, data dd/mm/aaaa, conta pelo nome
  const mercado = await screen.findByRole("article", { name: /Supermercado BH/ });
  await within(mercado).findByText("Nubank Ruth");
  expect(within(mercado).getByText("R$ 45,90")).toBeTruthy();
  expect(within(mercado).getByText("12/11/2026")).toBeTruthy();
  expect(within(mercado).getByText("Confiança: 62%")).toBeTruthy();
  // baixa confiança: texto, não só cor; duplicata; regra do plano; aviso geral
  expect(within(mercado).getAllByText(/Confira/).length).toBe(2);
  expect(within(mercado).getByText(/Já existe\?/).textContent).toContain("55");
  expect(within(mercado).getByText(/Regra do plano/)).toBeTruthy();
  expect(screen.getByText("Uma linha do extrato estava ilegível.")).toBeTruthy();
  expect(card(/Luz CEMIG/)).toBeTruthy();

  // NADA foi gravado: nenhuma chamada de escrita sem clique
  expect(writes()).toEqual([]);

  // editar antes de confirmar
  fireEvent.click(within(mercado).getByRole("button", { name: /Editar/ }));
  fireEvent.change(within(mercado).getByLabelText("Valor (R$)"), { target: { value: "1.052,30" } });
  fireEvent.change(within(mercado).getByLabelText("Descrição"), { target: { value: "Supermercado BH (editado)" } });
  fireEvent.click(within(mercado).getByRole("button", { name: "Salvar alterações" }));
  expect(writes()).toEqual([]); // salvar a edição também não grava

  const edited = screen.getByRole("article", { name: /editado/ });
  expect(within(edited).getByText("R$ 1.052,30")).toBeTruthy();
  fireEvent.click(within(edited).getByRole("button", { name: /Confirmar/ }));

  await within(edited).findByText(/Confirmado/);
  expect(writes()).toEqual(["POST /drafts/101/confirm"]);
  const sent = await bodyOf("POST /drafts/101/confirm");
  expect(sent).toMatchObject({
    kind: "expense",
    amount_cents: 105230,
    description: "Supermercado BH (editado)",
    account_id: 1,
    category_id: 10,
    owner: "RUTH",
  });
  expect(Number.isInteger(sent.amount_cents)).toBe(true);
});

it("imagem: anexo com prévia, remoção, progresso do upload e envio do arquivo", async () => {
  setup();
  const photo = new File(["img"], "cupom.jpg", { type: "image/jpeg" });
  pickFile(/Galeria/, photo);
  expect(screen.getByText(/cupom\.jpg/)).toBeTruthy();

  // remover o anexo desabilita o envio
  fireEvent.click(screen.getByRole("button", { name: /Remover anexo/ }));
  expect((screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement).disabled).toBe(true);

  pickFile(/Câmera/, photo);
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
  await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
  const xhr = FakeXHR.instances[0];
  expect((xhr.body?.get("file") as File).name).toBe("cupom.jpg");

  // durante o envio: botão desabilitado e progresso
  expect((screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement).disabled).toBe(true);
  act(() => xhr.progress(40, 100));
  expect(screen.getByText("Enviando… 40%")).toBeTruthy();
  expect(screen.getByRole("progressbar", { name: "Envio do arquivo" })).toBeTruthy();

  act(() => xhr.respond(200, INGEST_ONE));
  await screen.findByRole("article", { name: /Luz CEMIG/ });
  expect(writes()).toEqual([]);
  // a caixa foi limpa
  expect(screen.queryByText(/cupom\.jpg/)).toBeTruthy(); // fica na conversa ("Anexo: cupom.jpg")
  expect(screen.queryByRole("group", { name: "Anexo" })).toBeNull();
});

it("PDF: envia, confirma e só marca a conta como paga com outro toque", async () => {
  const luz = txFrom(DRAFT_LUZ, 777);
  setup({
    "POST /drafts/102/confirm": () => json(luz),
    "POST /bill-instances/31/pay": () => json({ id: 31 }),
  });
  pickFile(/PDF/, new File(["%PDF"], "conta-luz.pdf", { type: "application/pdf" }));
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
  await submitAndRespond(200, INGEST_ONE);

  const c = await screen.findByRole("article", { name: /Luz CEMIG/ });
  expect(within(c).queryByRole("button", { name: /Marcar como paga/ })).toBeNull();
  fireEvent.click(within(c).getByRole("button", { name: /Confirmar/ }));
  await within(c).findByText(/Confirmado/);

  // confirmar NÃO paga a conta sozinho
  expect(writes()).toEqual(["POST /drafts/102/confirm"]);
  fireEvent.click(within(c).getByRole("button", { name: /Marcar como paga/ }));
  await within(c).findByText(/marcada como paga/);
  expect(writes()).toEqual(["POST /drafts/102/confirm", "POST /bill-instances/31/pay"]);
  expect(await bodyOf("POST /bill-instances/31/pay")).toEqual({ transaction_id: 777 });
});

it("duplo clique em Confirmar gera uma única chamada", async () => {
  let release: (r: Response) => void = () => {};
  setup({ "POST /drafts/102/confirm": () => new Promise<Response>((r) => (release = r)) });
  write("luz");
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
  await submitAndRespond(200, INGEST_ONE);
  const c = await screen.findByRole("article", { name: /Luz CEMIG/ });
  const btn = within(c).getByRole("button", { name: /Confirmar/ });
  fireEvent.click(btn);
  fireEvent.click(btn);
  await waitFor(() => expect(writes()).toEqual(["POST /drafts/102/confirm"]));
  expect((btn as HTMLButtonElement).disabled).toBe(true);
  await act(async () => release(json(txFrom(DRAFT_LUZ, 5))));
  await within(c).findByText(/Confirmado/);
  expect(writes()).toEqual(["POST /drafts/102/confirm"]);
});

it("Confirmar todos pede confirmação e envia um lote só", async () => {
  setup({
    "POST /drafts/confirm-batch": () => json([txFrom(INGEST_TWO.drafts[0], 11), txFrom(INGEST_TWO.drafts[1], 12)]),
  });
  write("dois gastos");
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
  await submitAndRespond(200, INGEST_TWO);
  await screen.findByRole("article", { name: /Luz CEMIG/ });

  fireEvent.click(screen.getByRole("button", { name: "Confirmar todos" }));
  expect(screen.getByText("Confirmar 2 lançamentos?")).toBeTruthy();
  expect(writes()).toEqual([]); // a pergunta ainda não grava

  fireEvent.click(screen.getByRole("button", { name: "Sim, confirmar" }));
  await waitFor(() => expect(screen.getAllByText(/✓ Confirmado/)).toHaveLength(2));
  expect(writes()).toEqual(["POST /drafts/confirm-batch"]);
  expect(await bodyOf("POST /drafts/confirm-batch")).toEqual({ draft_ids: [101, 102] });
  // depois do lote, a conta sugerida continua exigindo toque próprio
  expect(within(card(/Luz CEMIG/)).getByRole("button", { name: /Marcar como paga/ })).toBeTruthy();
});

it("Confirmar todos: o cartão editado vai individual (com a edição) e os demais no lote", async () => {
  setup({
    "POST /drafts/confirm-batch": () => json([txFrom(INGEST_TWO.drafts[1], 12)]),
    "POST /drafts/101/confirm": (req) => req.clone().json().then((b) => json({ ...txFrom(INGEST_TWO.drafts[0], 11), ...b })),
  });
  write("dois gastos");
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
  await submitAndRespond(200, INGEST_TWO);
  const mercado = await screen.findByRole("article", { name: /Supermercado BH/ });
  fireEvent.click(within(mercado).getByRole("button", { name: /Editar/ }));
  fireEvent.change(within(mercado).getByLabelText("Valor (R$)"), { target: { value: "50" } });
  fireEvent.click(within(mercado).getByRole("button", { name: "Salvar alterações" }));

  fireEvent.click(screen.getByRole("button", { name: "Confirmar todos" }));
  expect(writes()).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Sim, confirmar" }));
  await waitFor(() => expect(screen.getAllByText(/✓ Confirmado/)).toHaveLength(2));
  expect(writes()).toEqual(["POST /drafts/confirm-batch", "POST /drafts/101/confirm"]);
  expect(await bodyOf("POST /drafts/confirm-batch")).toEqual({ draft_ids: [102] });
  expect(await bodyOf("POST /drafts/101/confirm")).toMatchObject({ amount_cents: 5000 });
});

it("Confirmar todos deixa de fora o que não tem conta e não aparece com 1 pendente", async () => {
  const result: IngestResult = { ...INGEST_TWO, drafts: [INGEST_TWO.drafts[1], DRAFT_SEM_CONTA] };
  setup({ "POST /drafts/102/discard": () => new Response(null, { status: 204 }) });
  write("x");
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
  await submitAndRespond(200, result);
  const padaria = await screen.findByRole("article", { name: /Padaria/ });
  expect((within(padaria).getByRole("button", { name: /Confirmar/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/sem conta definida/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Confirmar todos" }));
  expect(screen.getByText("Confirmar 1 lançamento?")).toBeTruthy();

  // descartar um deixa 1 pendente: some o "Confirmar todos"
  fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
  fireEvent.click(within(card(/Luz CEMIG/)).getByRole("button", { name: /Descartar/ }));
  await within(card(/Luz CEMIG/)).findByText(/Descartado/);
  expect(screen.queryByRole("button", { name: "Confirmar todos" })).toBeNull();
  expect(writes()).toEqual(["POST /drafts/102/discard"]);
});

it("403 ao confirmar mostra a mensagem de conta sem permissão", async () => {
  setup({ "POST /drafts/102/confirm": () => json({ detail: "forbidden" }, 403) });
  write("luz");
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
  await submitAndRespond(200, INGEST_ONE);
  const c = await screen.findByRole("article", { name: /Luz CEMIG/ });
  fireEvent.click(within(c).getByRole("button", { name: /Confirmar/ }));
  await within(c).findByText("Você não pode lançar nessa conta.");
  expect((within(c).getByRole("button", { name: /Confirmar/ }) as HTMLButtonElement).disabled).toBe(false);
});

it("409 atualiza o cartão com o estado real da extração", async () => {
  setup({
    "POST /drafts/102/confirm": () => json({ detail: "já resolvido" }, 409),
    "GET /ingest/8": () => json({ ...INGEST_ONE, drafts: [{ ...DRAFT_LUZ, status: "discarded" }] }),
  });
  write("luz");
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
  await submitAndRespond(200, INGEST_ONE);
  const c = await screen.findByRole("article", { name: /Luz CEMIG/ });
  fireEvent.click(within(c).getByRole("button", { name: /Confirmar/ }));
  await within(c).findByText(/Descartado/);
  expect(within(c).getByText("Esse rascunho já foi resolvido.")).toBeTruthy();
});

it("limite da IA (503) mostra a mensagem e abre o lançamento manual; valor vira centavos inteiros", async () => {
  setup({ "POST /transactions": (req) => req.clone().json().then((b) => json({ ...b, id: 1 }, 201)) });
  write("mercado");
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
  await submitAndRespond(503, { detail: "limite", code: "ai_limit_reached" });

  const alerts = await screen.findAllByRole("alert");
  expect(alerts.some((a) => a.textContent === "O limite mensal da IA foi atingido. Lance pelo formulário.")).toBe(true);
  const form = screen.getByRole("region", { name: "Lançar à mão" });
  expect(writes()).toEqual([]);

  // erros de validação antes de enviar
  fireEvent.click(within(form).getByRole("button", { name: "Salvar lançamento" }));
  expect(within(form).getByText("Informe um valor maior que zero, por exemplo 1.234,56.")).toBeTruthy();
  expect(within(form).getByText("Escolha a conta.")).toBeTruthy();
  expect(writes()).toEqual([]);

  await within(form).findByRole("option", { name: "Itaú Matheus (Matheus)" });
  fireEvent.change(within(form).getByLabelText("Valor (R$)"), { target: { value: "1.234,56" } });
  fireEvent.change(within(form).getByLabelText("Conta"), { target: { value: "2" } });
  fireEvent.change(within(form).getByLabelText("Categoria"), { target: { value: "10" } });
  fireEvent.change(within(form).getByLabelText("Descrição"), { target: { value: "Feira" } });
  fireEvent.click(within(form).getByRole("button", { name: "Salvar lançamento" }));

  await screen.findByText(/Lançamento criado/);
  expect(writes()).toEqual(["POST /transactions"]);
  const sent = await bodyOf("POST /transactions");
  expect(sent).toMatchObject({
    kind: "expense",
    amount_cents: 123456,
    account_id: 2,
    category_id: 10,
    owner: "MATHEUS",
    description: "Feira",
  });
  expect(sent).not.toHaveProperty("source");
  expect(screen.queryByRole("region", { name: "Lançar à mão" })).toBeNull();
});

it("'Lançar à mão' abre o formulário sem chamar a IA", async () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Lançar à mão" }));
  expect(screen.getByRole("region", { name: "Lançar à mão" })).toBeTruthy();
  expect(FakeXHR.instances).toHaveLength(0);
  expect(writes()).toEqual([]);
});

it("arquivo acima de 10 MB é recusado na hora, sem enviar", async () => {
  setup();
  const big = new File(["x"], "enorme.jpg", { type: "image/jpeg" });
  Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
  pickFile(/Galeria/, big);
  expect((await screen.findByRole("alert")).textContent).toMatch(/10 MB/);
  expect(screen.queryByRole("group", { name: "Anexo" })).toBeNull();
  expect(FakeXHR.instances).toHaveLength(0);
});

it("Enter envia e Shift+Enter não", async () => {
  setup();
  write("linha");
  fireEvent.keyDown(screen.getByLabelText("Mensagem"), { key: "Enter", shiftKey: true });
  expect(FakeXHR.instances).toHaveLength(0);
  fireEvent.keyDown(screen.getByLabelText("Mensagem"), { key: "Enter" });
  await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
});


it("409 num cartão editado mostra o que o servidor tem, não a edição local", async () => {
  setup({
    "POST /drafts/102/confirm": () => json({ detail: "já resolvido" }, 409),
    "GET /ingest/8": () => json({ ...INGEST_ONE, drafts: [{ ...DRAFT_LUZ, status: "confirmed" }] }),
  });
  write("luz");
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
  await submitAndRespond(200, INGEST_ONE);
  const c = await screen.findByRole("article", { name: /Luz CEMIG/ });
  fireEvent.click(within(c).getByRole("button", { name: /Editar/ }));
  fireEvent.change(within(c).getByLabelText("Valor (R$)"), { target: { value: "500" } });
  fireEvent.click(within(c).getByRole("button", { name: "Salvar alterações" }));
  expect(within(c).getByText(/500,00/)).toBeTruthy();

  fireEvent.click(within(c).getByRole("button", { name: /Confirmar/ }));
  await within(c).findByText("Esse rascunho já foi resolvido.");
  expect(within(c).queryByText(/500,00/)).toBeNull();
  expect(within(c).queryByText("Editado")).toBeNull();
});

it("409 no lote: o item que continua pendente recebe aviso (nada foi gravado)", async () => {
  setup({
    "POST /drafts/confirm-batch": () => json({ detail: "já resolvido" }, 409),
    "GET /ingest/7": () =>
      json({ ...INGEST_TWO, drafts: [{ ...INGEST_TWO.drafts[0], status: "confirmed" }, INGEST_TWO.drafts[1]] }),
  });
  write("dois gastos");
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
  await submitAndRespond(200, INGEST_TWO);
  await screen.findByRole("article", { name: /Luz CEMIG/ });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar todos" }));
  fireEvent.click(screen.getByRole("button", { name: "Sim, confirmar" }));

  const luz = card(/Luz CEMIG/);
  await within(luz).findByText(/nada foi gravado/);
  expect((within(luz).getByRole("button", { name: /Confirmar/ }) as HTMLButtonElement).disabled).toBe(false);
  expect(within(card(/Supermercado BH/)).getByText("Esse rascunho já foi resolvido.")).toBeTruthy();
});

it("cartão com conta sugerida editado para receita não oferece 'Marcar como paga'", async () => {
  setup({
    "POST /drafts/102/confirm": (req) =>
      req.clone().json().then((b) => json({ ...txFrom(DRAFT_LUZ, 778), ...b, id: 778 })),
  });
  write("luz");
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
  await submitAndRespond(200, INGEST_ONE);
  const c = await screen.findByRole("article", { name: /Luz CEMIG/ });
  fireEvent.click(within(c).getByRole("button", { name: /Editar/ }));
  fireEvent.change(within(c).getByLabelText("Tipo"), { target: { value: "income" } });
  fireEvent.click(within(c).getByRole("button", { name: "Salvar alterações" }));
  fireEvent.click(within(c).getByRole("button", { name: /Confirmar/ }));
  await within(c).findByText(/Confirmado/);
  expect(await bodyOf("POST /drafts/102/confirm")).toMatchObject({ kind: "income" });
  expect(within(c).queryByRole("button", { name: /Marcar como paga/ })).toBeNull();
});

it("avisos da API em cabeçalhos (duplicata, regra do plano) aparecem após confirmar", async () => {
  setup({
    "POST /drafts/102/confirm": () =>
      new Response(JSON.stringify(txFrom(DRAFT_LUZ, 779)), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Possible-Duplicate-Of": "55,56",
          "X-Plan-Rule-Warning": "Despesa no cartão fora das recorrências.",
        },
      }),
  });
  write("luz");
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
  await submitAndRespond(200, INGEST_ONE);
  const c = await screen.findByRole("article", { name: /Luz CEMIG/ });
  fireEvent.click(within(c).getByRole("button", { name: /Confirmar/ }));
  await within(c).findByText(/Confirmado/);
  expect(within(c).getByText(/nº 55, nº 56/)).toBeTruthy();
  expect(within(c).getByText(/fora das recorrências/)).toBeTruthy();
});

it("422 ao confirmar mostra o detail da API", async () => {
  setup({ "POST /drafts/102/confirm": () => json({ detail: "Data fora do intervalo permitido." }, 422) });
  write("luz");
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
  await submitAndRespond(200, INGEST_ONE);
  const c = await screen.findByRole("article", { name: /Luz CEMIG/ });
  fireEvent.click(within(c).getByRole("button", { name: /Confirmar/ }));
  await within(c).findByText("Data fora do intervalo permitido.");
});

it("trocar o anexo por um arquivo recusado não deixa o anterior para enviar", async () => {
  setup();
  pickFile(/Galeria/, new File(["x"], "foto.jpg", { type: "image/jpeg" }));
  expect(screen.getByRole("group", { name: "Anexo" })).toBeTruthy();
  const big = new File(["x"], "enorme.jpg", { type: "image/jpeg" });
  Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
  pickFile(/Galeria/, big);
  expect(screen.queryByRole("group", { name: "Anexo" })).toBeNull();
  expect((screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement).disabled).toBe(true);
});
