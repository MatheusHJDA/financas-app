import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { INGEST_ONE } from "./__fixtures__/ingest";
import { IngestError, LIMIT_MESSAGE, MAX_FILE_BYTES, sendIngest } from "./sendIngest";
import { FakeXHR, installFakeXHR } from "./testing";

const jpg = (name = "nota.jpg") => new File(["x"], name, { type: "image/jpeg" });

beforeEach(() => {
  installFakeXHR();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it("envia multipart com texto e arquivo, com cookies e progresso", async () => {
  const onProgress = vi.fn();
  const promise = sendIngest({ text: " mercado 45,90 ", file: jpg(), onProgress });
  const xhr = FakeXHR.instances[0];
  expect(xhr.method).toBe("POST");
  expect(xhr.url).toMatch(/\/api\/ingest$/);
  expect(xhr.withCredentials).toBe(true);
  expect(xhr.body?.get("text")).toBe("mercado 45,90");
  expect((xhr.body?.get("file") as File).name).toBe("nota.jpg");

  xhr.progress(25, 100);
  xhr.progress(50, 100);
  xhr.respond(200, INGEST_ONE);
  await expect(promise).resolves.toMatchObject({ extraction_id: 8 });
  expect(onProgress.mock.calls.map((c) => c[0])).toEqual([25, 50, 100]);
});

it("ao terminar o upload, avisa 100% antes da resposta (a tela passa a 'Lendo com a IA')", () => {
  const onProgress = vi.fn();
  void sendIngest({ file: jpg(), onProgress });
  const xhr = FakeXHR.instances[0];
  xhr.progress(60, 100);
  xhr.uploaded();
  expect(onProgress.mock.calls.map((c) => c[0])).toEqual([60, 100]);
});

it("arquivo acima de 10 MB é recusado localmente, sem enviar", async () => {
  const big = jpg("grande.jpg");
  Object.defineProperty(big, "size", { value: MAX_FILE_BYTES + 1 });
  await expect(sendIngest({ file: big })).rejects.toMatchObject({ kind: "local" });
  expect(FakeXHR.instances).toHaveLength(0);
});

it("só aceita imagem ou PDF e exige texto ou arquivo", async () => {
  const doc = new File(["x"], "a.docx", { type: "application/msword" });
  await expect(sendIngest({ file: doc })).rejects.toMatchObject({ kind: "local" });
  await expect(sendIngest({ text: "   " })).rejects.toMatchObject({ kind: "local" });
  expect(FakeXHR.instances).toHaveLength(0);
  const pdf = new File(["x"], "a.pdf", { type: "application/pdf" });
  const p = sendIngest({ file: pdf });
  FakeXHR.instances[0].respond(200, INGEST_ONE);
  await expect(p).resolves.toBeDefined();
});

it("503 de limite abre o formulário manual com a mensagem do limite", async () => {
  const p = sendIngest({ text: "oi" });
  FakeXHR.instances[0].respond(503, { detail: "x", code: "ai_limit_reached" });
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(IngestError);
  expect(err).toMatchObject({ kind: "ai_limit", message: LIMIT_MESSAGE, openManual: true });
});

it("503 ai_unavailable também abre o formulário manual", async () => {
  const p = sendIngest({ text: "oi" });
  FakeXHR.instances[0].respond(503, { detail: "x", code: "ai_unavailable" });
  await expect(p).rejects.toMatchObject({ kind: "ai_unavailable", openManual: true });
});

it("413 e 422 mostram o detail do servidor", async () => {
  const a = sendIngest({ text: "oi" });
  FakeXHR.instances[0].respond(422, { detail: "Formato não suportado." });
  await expect(a).rejects.toMatchObject({ message: "Formato não suportado.", openManual: false });
  const b = sendIngest({ text: "oi" });
  FakeXHR.instances[1].respond(413, { detail: "Arquivo grande demais." });
  await expect(b).rejects.toMatchObject({ message: "Arquivo grande demais." });
});

it("401 chama o fluxo de sessão expirada", async () => {
  const onUnauthorized = vi.fn();
  const p = sendIngest({ text: "oi", onUnauthorized });
  FakeXHR.instances[0].respond(401, { detail: "não autenticado" });
  await expect(p).rejects.toMatchObject({ kind: "unauthorized" });
  expect(onUnauthorized).toHaveBeenCalledTimes(1);
});

it("falha de rede vira mensagem amigável", async () => {
  const p = sendIngest({ text: "oi" });
  FakeXHR.instances[0].fail();
  await expect(p).rejects.toMatchObject({ kind: "network" });
});
