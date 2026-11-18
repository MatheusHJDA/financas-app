import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { json, mockFetch, ME, renderAdmin, stubViewport, USERS, type Call, type Handler } from "./testing";

let calls: Call[] = [];

/** `slug` = rota /admin/<slug>; `desktop` liga a tela larga (tabelas em vez de lista). */
function setup(extra: Record<string, Handler> = {}, slug = "usuarios", desktop = false) {
  stubViewport(desktop);
  calls = mockFetch({
    "GET /auth/me": () => json(ME),
    "GET /admin/users": () => json(USERS),
    ...extra,
  });
  renderAdmin(slug);
}

const writes = () => calls.filter((c) => c.req.method !== "GET").map((c) => c.key);
const bodyOf = async (key: string) => JSON.parse(await calls.find((c) => c.key === key)!.req.clone().text());

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("usuários: lista papel e bloqueio", async () => {
  setup();
  const matheus = await screen.findByRole("article", { name: "Matheus" });
  expect(within(matheus).getByText("Sem bloqueio")).toBeTruthy();
  expect(within(matheus).getByText(/Administrador/)).toBeTruthy();
  const ruth = screen.getByRole("article", { name: "Ruth" });
  expect(within(ruth).getByText(/Travada por tentativas erradas/)).toBeTruthy();
  expect(within(ruth).getByText(/3 tentativa/)).toBeTruthy();
  expect(within(ruth).getByText(/Membro/)).toBeTruthy();
});

it("redefinir PIN só grava depois de confirmar, com 6 dígitos", async () => {
  setup({ "POST /admin/users/2/reset-pin": () => new Response(null, { status: 204 }) });
  const ruth = await screen.findByRole("article", { name: "Ruth" });

  fireEvent.click(within(ruth).getByRole("button", { name: "Redefinir PIN de Ruth" }));
  expect(writes()).toEqual([]); // abrir o formulário não grava

  const field = screen.getByLabelText(/Novo PIN de Ruth/) as HTMLInputElement;
  const confirm = screen.getByRole("button", { name: "Confirmar redefinição" }) as HTMLButtonElement;
  fireEvent.change(field, { target: { value: "12a45" } });
  expect(field.value).toBe("1245"); // só dígitos
  expect(confirm.disabled).toBe(true);
  fireEvent.click(confirm);
  expect(writes()).toEqual([]);

  fireEvent.change(field, { target: { value: "246810" } });
  const repeat = screen.getByLabelText("Repita o novo PIN");
  fireEvent.change(repeat, { target: { value: "246811" } });
  expect(screen.getByRole("alert").textContent).toMatch(/não são iguais/);
  expect(confirm.disabled).toBe(true); // PINs diferentes não deixam gravar
  fireEvent.click(confirm);
  expect(writes()).toEqual([]);
  fireEvent.change(repeat, { target: { value: "246810" } });
  expect(confirm.disabled).toBe(false);
  expect(writes()).toEqual([]); // digitar também não grava
  fireEvent.click(confirm);

  await waitFor(() => expect(writes()).toEqual(["POST /admin/users/2/reset-pin"]));
  expect(await bodyOf("POST /admin/users/2/reset-pin")).toEqual({ new_pin: "246810" });
  expect(await screen.findByText(/PIN de Ruth redefinido/)).toBeTruthy();
  expect(screen.queryByLabelText(/Novo PIN de Ruth/)).toBeNull(); // o PIN sai da tela
});

it("cancelar a redefinição não grava nada", async () => {
  setup();
  const ruth = await screen.findByRole("article", { name: "Ruth" });
  fireEvent.click(within(ruth).getByRole("button", { name: "Redefinir PIN de Ruth" }));
  fireEvent.change(screen.getByLabelText(/Novo PIN de Ruth/), { target: { value: "246810" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(writes()).toEqual([]);
  expect(screen.queryByLabelText(/Novo PIN de Ruth/)).toBeNull();
});

it("redefinir PIN: 403 do servidor vira mensagem", async () => {
  setup({ "POST /admin/users/2/reset-pin": () => json({ detail: "Apenas o administrador." }, 403) });
  const ruth = await screen.findByRole("article", { name: "Ruth" });
  fireEvent.click(within(ruth).getByRole("button", { name: "Redefinir PIN de Ruth" }));
  fireEvent.change(screen.getByLabelText(/Novo PIN de Ruth/), { target: { value: "246810" } });
  fireEvent.change(screen.getByLabelText("Repita o novo PIN"), { target: { value: "246810" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar redefinição" }));
  expect(await screen.findByText(/não tem permissão/)).toBeTruthy();
});

it("encerrar sessões pede confirmação antes de chamar a API", async () => {
  setup({ "DELETE /admin/users/2/sessions": () => new Response(null, { status: 204 }) });
  const ruth = await screen.findByRole("article", { name: "Ruth" });
  fireEvent.click(within(ruth).getByRole("button", { name: "Encerrar sessões de Ruth" }));
  expect(writes()).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
  await waitFor(() => expect(writes()).toEqual(["DELETE /admin/users/2/sessions"]));
  expect(await screen.findByText("Sessões de Ruth encerradas.")).toBeTruthy();
});

it("redefinir PIN: o foco vai ao campo do PIN e volta ao botão ao cancelar", async () => {
  setup();
  const ruth = await screen.findByRole("article", { name: "Ruth" });
  const open = within(ruth).getByRole("button", { name: "Redefinir PIN de Ruth" });
  fireEvent.click(open);
  expect(document.activeElement).toBe(screen.getByLabelText(/Novo PIN de Ruth/));
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Redefinir PIN de Ruth" }));
});

it("encerrar sessões: o foco vai ao Cancelar (opção segura) e volta ao botão ao cancelar", async () => {
  setup();
  const ruth = await screen.findByRole("article", { name: "Ruth" });
  fireEvent.click(within(ruth).getByRole("button", { name: "Encerrar sessões de Ruth" }));
  const cancelar = screen.getByRole("button", { name: "Cancelar" });
  expect(document.activeElement).toBe(cancelar);
  fireEvent.click(cancelar);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Encerrar sessões de Ruth" }));
});

it("encerrar as próprias sessões avisa que a atual também cai", async () => {
  setup();
  const matheus = await screen.findByRole("article", { name: "Matheus" });
  fireEvent.click(within(matheus).getByRole("button", { name: "Encerrar sessões de Matheus" }));
  expect(screen.getByText(/também encerra a sua sessão/)).toBeTruthy();
});

it("configurações: mostra os valores e salva os 3 campos (antecedência inteira)", async () => {
  setup({
    "GET /admin/settings": () =>
      json({ "notify.daily_time": "21:00", "notify.bill_time": "09:00", "notify.bill_days_before": 2 }),
    "PUT /admin/settings": (req) => req.clone().json().then((b) => json(b)),
  }, "configuracoes");
  const daily = (await screen.findByLabelText("Horário do resumo diário")) as HTMLInputElement;
  expect(daily.value).toBe("21:00");
  expect((screen.getByLabelText("Horário do aviso de vencimento") as HTMLInputElement).value).toBe("09:00");
  expect((screen.getByLabelText(/antecedência/) as HTMLInputElement).value).toBe("2");

  fireEvent.change(daily, { target: { value: "20:30" } });
  fireEvent.change(screen.getByLabelText(/antecedência/), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar configurações" }));

  expect(await screen.findByText("Configurações salvas.")).toBeTruthy();
  expect(await bodyOf("PUT /admin/settings")).toEqual({
    "notify.daily_time": "20:30",
    "notify.bill_time": "09:00",
    "notify.bill_days_before": 3,
  });
});

it("configurações: antecedência inválida não chama a API", async () => {
  setup({
    "GET /admin/settings": () =>
      json({ "notify.daily_time": "21:00", "notify.bill_time": "09:00", "notify.bill_days_before": 2 }),
  }, "configuracoes");
  const days = await screen.findByLabelText(/antecedência/);
  fireEvent.change(days, { target: { value: "11" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar configurações" }));
  expect(await screen.findByText(/inteiro de 0 a 10/)).toBeTruthy();
  expect(writes()).toEqual([]);
});

it("notificações: envio de teste mostra quantos aparelhos receberam e lista aparelhos", async () => {
  setup({
    "GET /admin/push-subscriptions": () =>
      json([
        {
          id: 7,
          user_id: 2,
          endpoint: "https://push.example/secreto",
          device_label: "iPhone da Ruth",
          created_at: "2026-11-01T12:00:00Z",
          last_ok_at: null,
        },
      ]),
    "POST /admin/notifications/test": () => json({ sent: 2 }),
  }, "avisos");
  expect(await screen.findByText("iPhone da Ruth")).toBeTruthy();
  expect(screen.getByText(/Ainda sem envio com sucesso/)).toBeTruthy();
  expect(screen.queryByText(/push\.example/)).toBeNull(); // o endpoint não aparece

  fireEvent.click(screen.getByRole("button", { name: "Enviar teste para Ruth" }));
  expect(await screen.findByText(/Teste enviado para Ruth: 2 aparelhos receberam/)).toBeTruthy();
  expect(await bodyOf("POST /admin/notifications/test")).toEqual({ user_id: 2 });
});

it("notificações: 0 aparelhos explica o que fazer", async () => {
  setup({
    "GET /admin/push-subscriptions": () => json([]),
    "POST /admin/notifications/test": () => json({ sent: 0 }),
  }, "avisos");
  expect(await screen.findByText("Nenhum aparelho inscrito")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Enviar teste para Matheus" }));
  expect(await screen.findByText(/0 aparelhos receberam/)).toBeTruthy();
});

it("IA: tabela com modelo, tokens, custo e contagem de falhas e limites 429", async () => {
  const base = { user_id: 2, input_kind: "text", prompt_version: "v1", created_at: "2026-11-12T15:00:00Z" };
  setup({
    "GET /admin/ai/calls": () =>
      json({
        total: 3,
        items: [
          { ...base, id: 3, model: "modelo-x", usage_tokens: 1200, est_cost_cents: 150, status: "ok", error_code: null },
          { ...base, id: 2, model: "modelo-x", usage_tokens: null, est_cost_cents: null, status: "error", error_code: "ai_limit_reached" },
          { ...base, id: 1, model: "modelo-x", usage_tokens: 10, est_cost_cents: 1, status: "error", error_code: "ai_unavailable" },
        ],
      }),
  }, "ia", true);
  const table = await screen.findByRole("table");
  const rows = within(table).getAllByRole("row");
  expect(rows).toHaveLength(4);
  expect(within(rows[1]).getByText("modelo-x")).toBeTruthy();
  expect(within(rows[1]).getByText("1.200")).toBeTruthy();
  expect(within(rows[1]).getByText("US$ 1,50")).toBeTruthy();
  expect(within(rows[1]).getByText("Ok")).toBeTruthy();
  expect(within(rows[2]).getByText("Falha (ai_limit_reached)")).toBeTruthy();
  expect(within(rows[2]).getAllByText("—")).toHaveLength(2);

  const stats = screen.getByLabelText("Resumo das chamadas desta página");
  expect(within(stats).getByText("Falhas na página").nextSibling?.textContent).toBe("2");
  expect(within(stats).getByText("Limites 429 na página").nextSibling?.textContent).toBe("1");
  expect(within(stats).getByText("Total de chamadas").nextSibling?.textContent).toBe("3");
});

it("auditoria: filtra por entidade e usuário e pagina", async () => {
  const event = (id: number) => ({
    id,
    user_id: 1,
    entity: "goals",
    entity_id: String(id),
    action: "create",
    before: null,
    after: { name: "Viagem" },
    at: "2026-11-12T15:00:00Z",
  });
  setup({
    "GET /admin/audit": (req) => {
      const q = new URL(req.url).searchParams;
      const offset = Number(q.get("offset") ?? 0);
      return json({ total: 45, items: [event(offset + 1)] });
    },
  }, "auditoria");
  expect(await screen.findByText("Criou goals #1")).toBeTruthy();
  expect(screen.getByText("1–1 de 45")).toBeTruthy();
  expect(calls.at(-1)!.url.searchParams.get("entity")).toBeNull();

  fireEvent.change(screen.getByLabelText(/Entidade/), { target: { value: "goals" } });
  await screen.findByRole("option", { name: "Ruth" });
  fireEvent.change(screen.getByLabelText("Usuário"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));
  await waitFor(() => {
    const last = calls.filter((c) => c.key === "GET /admin/audit").at(-1)!;
    expect(last.url.searchParams.get("entity")).toBe("goals");
    expect(last.url.searchParams.get("user_id")).toBe("2");
    expect(last.url.searchParams.get("offset")).toBe("0");
  });

  fireEvent.click(screen.getByRole("button", { name: "Mais antigas" }));
  await waitFor(() => {
    const last = calls.filter((c) => c.key === "GET /admin/audit").at(-1)!;
    expect(last.url.searchParams.get("offset")).toBe("20");
    expect(last.url.searchParams.get("entity")).toBe("goals");
  });
  expect(await screen.findByText("Criou goals #21")).toBeTruthy();
});

it("auditoria: evento sem usuário aparece como Sistema e mostra detalhes", async () => {
  setup({
    "GET /admin/audit": () =>
      json({
        total: 1,
        items: [
          { id: 1, user_id: null, entity: "users", entity_id: "2", action: "update", before: null, after: { pin_changed: true }, at: "2026-11-12T15:00:00Z" },
        ],
      }),
  }, "auditoria");
  expect(await screen.findByText("Alterou users #2")).toBeTruthy();
  expect(screen.getByText(/^Sistema · /)).toBeTruthy();
  expect(screen.getByText(/pin_changed/)).toBeTruthy();
  // "Ver detalhes" sozinho se repete em cada evento: o nome acessível diz de qual
  expect(screen.getByText(/^Ver detalhes/).textContent).toBe("Ver detalhes de Alterou users #2");
});

it("usuários e auditoria no computador: a rolagem horizontal é focável e tem nome", async () => {
  setup({}, "usuarios", true);
  const users = await screen.findByRole("region", { name: "Tabela de usuários" });
  expect(users.getAttribute("tabindex")).toBe("0");
  cleanup();

  setup(
    {
      "GET /admin/audit": () =>
        json({
          total: 1,
          items: [{ id: 1, user_id: 2, entity: "goals", entity_id: "9", action: "delete", before: { name: "Viagem" }, after: null, at: "2026-11-12T15:00:00Z" }],
        }),
    },
    "auditoria",
    true,
  );
  const audit = await screen.findByRole("region", { name: "Tabela de eventos de auditoria" });
  expect(audit.getAttribute("tabindex")).toBe("0");
});

it("sistema: estado, exportação CSV e download do backup", async () => {
  setup({
    "GET /admin/system": () =>
      json({
        database_ok: true,
        scheduler_ok: false,
        last_backup_at: "2026-11-12T03:00:00Z",
        last_backup_size_bytes: 3_500_000,
      }),
  }, "sistema");
  expect(await screen.findByText("Parado")).toBeTruthy();
  expect(screen.getByText("OK")).toBeTruthy();
  expect(screen.getByText(/12\/11\/2026 00:00 · 3,3 MB/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Exportar lançamentos (CSV)" }).getAttribute("href")).toBe(
    "/api/transactions/export.csv",
  );
  expect(screen.getByRole("link", { name: "Baixar backup" }).getAttribute("href")).toBe("/api/admin/backups/latest");
});

it("sistema: sem backup não oferece o download", async () => {
  setup({
    "GET /admin/system": () =>
      json({ database_ok: false, scheduler_ok: true, last_backup_at: null, last_backup_size_bytes: null }),
  }, "sistema");
  expect(await screen.findByText("Nenhum backup encontrado")).toBeTruthy();
  expect(screen.getByText("Com problema")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Baixar backup" })).toBeNull();
  expect(screen.getByRole("link", { name: "Exportar lançamentos (CSV)" })).toBeTruthy();
});

// --- U22: uma página por seção, tabelas no computador, lista no celular, cartões de números ---------

const SECTION_TITLES: [string, string][] = [
  ["usuarios", "Usuários"],
  ["configuracoes", "Configurações"],
  ["avisos", "Avisos do sistema"],
  ["ia", "IA"],
  ["auditoria", "Auditoria"],
  ["sistema", "Sistema"],
];

const EMPTY_ROUTES: Record<string, Handler> = {
  "GET /admin/settings": () =>
    json({ "notify.daily_time": "21:00", "notify.bill_time": "09:00", "notify.bill_days_before": 2 }),
  "GET /admin/push-subscriptions": () => json([]),
  "GET /admin/ai/calls": () => json({ total: 0, items: [] }),
  "GET /admin/audit": () => json({ total: 0, items: [] }),
  "GET /admin/system": () =>
    json({ database_ok: true, scheduler_ok: true, last_backup_at: null, last_backup_size_bytes: null }),
};

const aiCall = (over: Record<string, unknown>) => ({
  id: 1,
  user_id: 2,
  input_kind: "text",
  prompt_version: "v1",
  created_at: "2026-11-12T15:00:00Z",
  model: "modelo-x",
  usage_tokens: 1200,
  est_cost_cents: 150,
  status: "ok",
  error_code: null,
  ...over,
});

it.each(SECTION_TITLES)("a rota /admin/%s abre a seção com o título %s", async (slug, title) => {
  setup(EMPTY_ROUTES, slug);
  expect(await screen.findByRole("heading", { name: title, level: 1 })).toBeTruthy();
  expect(document.getElementById(`admin-${slug}`)).not.toBeNull();
});

it("slug desconhecido redireciona para /admin/usuarios", async () => {
  setup(EMPTY_ROUTES, "inexistente");
  expect(await screen.findByRole("heading", { name: "Usuários", level: 1 })).toBeTruthy();
  expect(await screen.findByRole("article", { name: "Matheus" })).toBeTruthy();
});

it("não há mais abas internas: as seções vêm do menu", async () => {
  setup();
  await screen.findByRole("article", { name: "Matheus" });
  expect(screen.queryByRole("navigation", { name: "Seções do painel" })).toBeNull();
});

it("carregando mostra skeleton (status ocupado) e não spinner", async () => {
  setup({ "GET /admin/system": () => new Promise<Response>(() => {}) }, "sistema");
  const status = await screen.findByRole("status", { name: /Carregando/ });
  expect(status.getAttribute("aria-busy")).toBe("true");
  expect(document.querySelector(".spinner")).toBeNull();
});

it("usuários no computador: tabela com ações e confirmação na linha", async () => {
  setup({ "DELETE /admin/users/2/sessions": () => new Response(null, { status: 204 }) }, "usuarios", true);
  const table = await screen.findByRole("table", { name: "Usuários" });
  const rows = within(table).getAllByRole("row");
  expect(rows).toHaveLength(3); // cabeçalho + 2 pessoas
  expect(within(rows[1]).getByText("Matheus")).toBeTruthy();
  expect(within(rows[1]).getByText("Administrador")).toBeTruthy();
  expect(within(rows[2]).getByText(/Travada por tentativas erradas/)).toBeTruthy();
  expect(screen.queryByRole("article")).toBeNull(); // sem a versão de celular

  fireEvent.click(within(rows[2]).getByRole("button", { name: "Encerrar sessões de Ruth" }));
  expect(writes()).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
  await waitFor(() => expect(writes()).toEqual(["DELETE /admin/users/2/sessions"]));
});

it("IA no celular: lista em vez de tabela, com os mesmos dados", async () => {
  setup({ "GET /admin/ai/calls": () => json({ total: 1, items: [aiCall({})] }) }, "ia");
  expect(await screen.findByText("modelo-x")).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.getByText(/1\.200 tokens/)).toBeTruthy();
  expect(screen.getAllByText("US$ 1,50").length).toBeGreaterThan(0);
});

it("IA: cartões de números no topo, com o custo estimado vindo da API", async () => {
  setup({ "GET /admin/ai/calls": () => json({ total: 7, items: [aiCall({ est_cost_cents: 275 })] }) }, "ia");
  const cost = await screen.findByRole("group", { name: "Custo da última chamada" });
  expect(within(cost).getByText("US$ 2,75")).toBeTruthy();
  expect(within(screen.getByRole("group", { name: "Total de chamadas" })).getByText("7")).toBeTruthy();
});

it("sistema: cartões de números para banco, agendador e backup", async () => {
  setup(
    {
      "GET /admin/system": () =>
        json({ database_ok: true, scheduler_ok: false, last_backup_at: "2026-11-12T03:00:00Z", last_backup_size_bytes: 3_500_000 }),
    },
    "sistema",
  );
  expect(within(await screen.findByRole("group", { name: "Banco de dados" })).getByText("OK")).toBeTruthy();
  expect(within(screen.getByRole("group", { name: "Agendador de avisos" })).getByText("Parado")).toBeTruthy();
  expect(within(screen.getByRole("group", { name: "Último backup" })).getByText(/3,3 MB/)).toBeTruthy();
});

it("auditoria no computador: tabela com quem, quando e o quê", async () => {
  setup(
    {
      "GET /admin/audit": () =>
        json({
          total: 1,
          items: [
            { id: 1, user_id: 2, entity: "goals", entity_id: "9", action: "delete", before: { name: "Viagem" }, after: null, at: "2026-11-12T15:00:00Z" },
          ],
        }),
    },
    "auditoria",
    true,
  );
  const table = await screen.findByRole("table", { name: "Eventos de auditoria" });
  const row = within(table).getAllByRole("row")[1];
  expect(within(row).getByText("Excluiu goals #9")).toBeTruthy();
  expect(await within(row).findByText("Ruth")).toBeTruthy();
  expect(within(row).getByText("12/11/2026 12:00")).toBeTruthy();
  expect(within(row).getByText(/Viagem/)).toBeTruthy();
});

it("avisos: sem aparelhos, a dica aponta para Preferências", async () => {
  setup({ "GET /admin/push-subscriptions": () => json([]) }, "avisos");
  expect(await screen.findByText("Nenhum aparelho inscrito")).toBeTruthy();
  expect(screen.getByText(/Preferências/)).toBeTruthy();
});
