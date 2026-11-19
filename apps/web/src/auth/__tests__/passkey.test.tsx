import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const webauthn = vi.hoisted(() => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
vi.mock("@simplewebauthn/browser", () => webauthn);

import { AuthProvider } from "../AuthProvider";
import { LoginPage } from "../LoginPage";
import { RequireAuth } from "../RequireAuth";
import { safeNext } from "../passkeyLogin";

const RUTH = { id: 2, name: "Ruth", role: "member", owner: "RUTH" };
const GENERIC = "Não foi possível entrar. Confira o nome e o PIN.";
const CODES = ["AAAAA-BBBBB", "CCCCC-DDDDD", "EEEEE-FFFFF", "GGGGG-HHHHH", "JJJJJ-KKKKK", "MMMMM-NNNNN", "PPPPP-QQQQQ", "RRRRR-SSSSS"];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let starts: { name: string; pin: string; release_code: string | null }[] = [];
let finishStatus = 200;
let startMode: "login" | "register" = "login";
let recovery: string[] | null = null;
let signedIn = false;
let configStatus = 200;
let legacyLogins = 0;

beforeEach(() => {
  starts = [];
  finishStatus = 200;
  startMode = "login";
  recovery = null;
  signedIn = false;
  configStatus = 200;
  legacyLogins = 0;
  webauthn.startAuthentication.mockReset().mockResolvedValue({ id: "cred" });
  webauthn.startRegistration.mockReset().mockResolvedValue({ id: "new" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (req: Request) => {
      const path = new URL(req.url).pathname.replace(/^\/api/, "");
      if (path === "/auth/me") return signedIn ? json(RUTH) : json({ detail: "x" }, 401);
      if (path === "/auth/config") return configStatus === 200 ? json({ passkey_required: true }) : json({ detail: "x" }, configStatus);
      if (path === "/auth/login") {
        legacyLogins += 1;
        return json(RUTH);
      }
      if (path === "/auth/login/start") {
        starts.push(await req.json());
        return json({ attempt_id: "a1", mode: startMode, options: { challenge: "c" } });
      }
      if (path === "/auth/login/finish") {
        if (finishStatus !== 200) return json({ detail: "x" }, finishStatus);
        signedIn = true;
        return json({ me: RUTH, recovery_codes: recovery });
      }
      return json({ detail: "não mockado" }, 500);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<RequireAuth />}>
              <Route path="*" element={<Where />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

// "Entrar" só existe no modo com chave: esperar por ele garante que a configuração já chegou.
const fill = async (name = "Ruth", pin = "123456") => {
  await screen.findByRole("button", { name: "Entrar" });
  fireEvent.change(screen.getByLabelText("Seu nome"), { target: { value: name } });
  for (const d of pin) fireEvent.click(screen.getByRole("button", { name: d }));
};
const enter = () => fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
const CONFIRM = "Usar Face ID / digital / Windows Hello";
const confirm = async () => fireEvent.click(await screen.findByRole("button", { name: CONFIRM }));

describe("entrada com chave de acesso", () => {
  it("nome + PIN + Entrar: start sem código, startAuthentication e vai para o destino", async () => {
    renderAt("/login?next=%2Flancar%3Fmeta%3D4");
    await fill();
    expect(starts).toEqual([]); // o PIN não envia sozinho aos 6 dígitos
    enter();
    await confirm();
    await screen.findByTestId("where");
    expect(starts).toEqual([{ name: "Ruth", pin: "123456", device_label: expect.any(String), release_code: null }]);
    expect(webauthn.startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: "c" } });
    expect(screen.getByTestId("where").textContent).toBe("/lancar?meta=4");
  });

  it("com código de liberação registra a chave e mostra os códigos de emergência", async () => {
    startMode = "register";
    recovery = CODES;
    renderAt("/login");
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Tenho um código de liberação" }));
    fireEvent.change(screen.getByLabelText("Código de liberação"), { target: { value: "ABCDE-FGHJK" } });
    enter();
    await confirm();
    expect(await screen.findByRole("heading", { name: "Guarde seus códigos de emergência" })).toBeTruthy();
    expect(starts[0]?.release_code).toBe("ABCDE-FGHJK");
    expect(webauthn.startRegistration).toHaveBeenCalledTimes(1);
    expect(webauthn.startAuthentication).not.toHaveBeenCalled();
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    expect(screen.queryByTestId("where")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Já guardei" }));
    expect((await screen.findByTestId("where")).textContent).toBe("/");
  });

  it("aparelho que já tem a chave recusa o cadastro: avisa para entrar sem o código", async () => {
    startMode = "register";
    webauthn.startRegistration.mockRejectedValueOnce(
      Object.assign(new Error("The authenticator was previously registered"), {
        name: "InvalidStateError",
        code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED",
      }),
    );
    renderAt("/login");
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Tenho um código de liberação" }));
    fireEvent.change(screen.getByLabelText("Código de liberação"), { target: { value: "ABCDE-FGHJK" } });
    enter();
    await confirm();
    expect(
      await screen.findByText("Este aparelho já tem chave de acesso. Entre sem o código de liberação."),
    ).toBeTruthy();
    expect(screen.getByLabelText("Seu nome")).toBeTruthy();
  });

  it("401 em finish mostra a mensagem genérica, limpa o PIN e volta ao passo 1", async () => {
    finishStatus = 401;
    renderAt("/login");
    await fill();
    enter();
    await confirm();
    expect(await screen.findByText(GENERIC)).toBeTruthy();
    expect(await screen.findByRole("img", { name: "0 de 6 dígitos" })).toBeTruthy();
    expect(screen.getByLabelText("Seu nome")).toBeTruthy();
  });

  it("Entrar só chama start; o WebAuthn espera o toque no passo 2", async () => {
    renderAt("/login");
    await fill();
    enter();
    expect(await screen.findByRole("heading", { name: "Confirme neste aparelho" })).toBeTruthy();
    expect(starts).toHaveLength(1);
    expect(webauthn.startAuthentication).not.toHaveBeenCalled();
    await confirm();
    expect(webauthn.startAuthentication).toHaveBeenCalledTimes(1);
  });

  it("cancelado mostra aviso e refaz com a mesma tentativa, sem novo start", async () => {
    webauthn.startAuthentication.mockRejectedValueOnce(Object.assign(new Error("x"), { name: "NotAllowedError" }));
    renderAt("/login");
    await fill();
    enter();
    await confirm();
    expect(await screen.findByText("Confirmação cancelada. Toque para tentar de novo.")).toBeTruthy();
    expect(starts).toHaveLength(1);
    await confirm();
    await screen.findByTestId("where");
    expect(starts).toHaveLength(1);
    expect(webauthn.startAuthentication).toHaveBeenCalledTimes(2);
    expect(webauthn.startAuthentication.mock.calls[1]).toEqual(webauthn.startAuthentication.mock.calls[0]);
  });

  it("cancelado sugere o código de liberação e Voltar leva ao passo 1 sem PIN", async () => {
    webauthn.startAuthentication.mockRejectedValueOnce(Object.assign(new Error("x"), { name: "NotAllowedError" }));
    renderAt("/login");
    await fill();
    enter();
    await confirm();
    expect(await screen.findByText("Aparelho novo? Volte e use “Tenho um código de liberação”.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect(await screen.findByRole("img", { name: "0 de 6 dígitos" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Confirme neste aparelho" })).toBeNull();
    expect(screen.queryByText(GENERIC)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tenho um código de liberação" }));
    expect(screen.getByLabelText("Código de liberação")).toBeTruthy();
  });

  it("Voltar no passo 2 funciona mesmo sem cancelar", async () => {
    renderAt("/login");
    await fill();
    enter();
    await screen.findByRole("heading", { name: "Confirme neste aparelho" });
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect(await screen.findByLabelText("Seu nome")).toBeTruthy();
    expect(webauthn.startAuthentication).not.toHaveBeenCalled();
  });

  it("tentativa velha (> 100 s) refaz o start e pede outro toque antes do WebAuthn", async () => {
    renderAt("/login");
    await fill();
    const now = Date.now();
    const spy = vi.spyOn(Date, "now").mockReturnValue(now);
    enter();
    await screen.findByRole("heading", { name: "Confirme neste aparelho" });
    spy.mockReturnValue(now + 101_000);
    await confirm();
    await waitFor(() => expect(starts).toHaveLength(2));
    expect(webauthn.startAuthentication).not.toHaveBeenCalled();
    await confirm();
    await screen.findByTestId("where");
    expect(webauthn.startAuthentication).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("configuração indisponível", () => {
  it("falha em /auth/config mostra erro com nova tentativa e não envia o PIN", async () => {
    configStatus = 500;
    renderAt("/login");
    expect(await screen.findByText("Não foi possível falar com o servidor.", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByLabelText("Seu nome")).toBeNull();
    expect(legacyLogins).toBe(0);
    configStatus = 200;
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("button", { name: "Entrar" })).toBeTruthy();
    expect(legacyLogins).toBe(0);
  });
});

describe("volta ao destino", () => {
  it("sem sessão em /lancar?meta=4 vai ao login e, depois de entrar, volta para lá", async () => {
    renderAt("/lancar?meta=4");
    await fill();
    enter();
    await confirm();
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/lancar?meta=4"));
  });

  it("safeNext só aceita caminhos internos", () => {
    expect(safeNext("//mal.com")).toBe("/");
    expect(safeNext("https://mal.com")).toBe("/");
    expect(safeNext(null)).toBe("/");
    expect(safeNext("/lancar?meta=4")).toBe("/lancar?meta=4");
  });
});
