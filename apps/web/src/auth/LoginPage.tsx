import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Wallet } from "lucide-react";
import { api } from "../api/client";
import { Button } from "../ui/Button";
import { ErrorState, LoadingState } from "../ui/States";
import { useAuth, type Me } from "./AuthProvider";
import { deviceLabel } from "./deviceLabel";
import "./login.css";
import {
  CANCELLED,
  completePasskey,
  isFresh,
  LoginError,
  safeNext,
  startPasskeyAttempt,
  useAuthConfig,
  type PasskeyAttempt,
} from "./passkeyLogin";
import { PIN_LENGTH, PinPad } from "./PinPad";
import { RecoveryCodes } from "./RecoveryCodes";

const NAME_FIRST = "Digite seu nome antes do PIN.";
const CANCELLED_TEXT = "Confirmação cancelada. Toque para tentar de novo.";
// Sem chave neste aparelho, o sistema só oferece cancelar: mostra a saída.
const NEW_DEVICE_HINT = "Aparelho novo? Volte e use “Tenho um código de liberação”.";

// Mesma mensagem para nome errado, PIN errado ou conta travada: não revela o que falhou.
function messageFor(error: unknown): string {
  if (error instanceof LoginError) {
    if (error.status === 401) return "Não foi possível entrar. Confira o nome e o PIN.";
    if (error.status === 429) return "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
  }
  return "Não foi possível entrar. Verifique a conexão e tente de novo.";
}

interface Credentials {
  name: string;
  pin: string;
  releaseCode: string | null;
}

export function LoginPage() {
  const { me, setMe } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const config = useAuthConfig();
  const passkey = config.data?.passkey_required === true;
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [notice, setNotice] = useState("");
  const [asking, setAsking] = useState(false);
  const [releaseCode, setReleaseCode] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [pending, setPending] = useState<{ me: Me; codes: string[] } | null>(null);
  const creds = useRef<Credentials | null>(null);
  const [attempt, setAttempt] = useState<PasskeyAttempt | null>(null);
  const [pkBusy, setPkBusy] = useState(false);
  const [pkError, setPkError] = useState<unknown>(null);
  const [cancelled, setCancelled] = useState(false);

  const finish = (signedIn: Me) => {
    setMe(signedIn);
    void navigate(next, { replace: true });
  };

  const login = useMutation({
    mutationFn: async (body: { name: string; pin: string }) => {
      const { data, response } = await api.POST("/auth/login", {
        body: { ...body, device_label: deviceLabel() },
      });
      if (!data) throw new LoginError(response.status, `HTTP ${response.status}`);
      return data;
    },
    onSuccess: finish,
    onError: () => setPin(""),
  });

  const backToStart = (e: unknown) => {
    creds.current = null;
    setAttempt(null);
    setPin("");
    setStep(1);
    setPkError(e);
  };

  // Passo 1 (e renovação de tentativa velha): só `start`; o WebAuthn espera um toque novo.
  const runStart = async (c: Credentials) => {
    setPkBusy(true);
    try {
      setAttempt(await startPasskeyAttempt(c));
      setCancelled(false);
      setPkError(null);
      setStep(2);
    } catch (e) {
      backToStart(e);
    } finally {
      setPkBusy(false);
    }
  };

  // Toque no botão do passo 2: WebAuthn direto do clique, sem await antes.
  const confirmHere = () => {
    if (!attempt || !creds.current) return;
    if (!isFresh(attempt)) {
      void runStart(creds.current);
      return;
    }
    setPkBusy(true);
    setCancelled(false);
    completePasskey(attempt).then(
      ({ me: signedIn, recoveryCodes }) => {
        setPkBusy(false);
        creds.current = null;
        if (recoveryCodes?.length) setPending({ me: signedIn, codes: recoveryCodes });
        else finish(signedIn);
      },
      (e: unknown) => {
        setPkBusy(false);
        if (e instanceof LoginError && e.message === CANCELLED) setCancelled(true);
        else backToStart(e); // a tentativa foi gasta: volta ao passo 1
      },
    );
  };

  if (pending) {
    return (
      <main className="login-page">
        <RecoveryCodes codes={pending.codes} onDone={() => finish(pending.me)} />
      </main>
    );
  }
  if (me) return <Navigate to={next} replace />;
  if (config.isError) return <ErrorState message="Não foi possível falar com o servidor." onRetry={() => void config.refetch()} />;
  if (config.isPending) return <LoadingState />;

  const typedName = name.trim();
  const submitPasskey = () => {
    if (!typedName) {
      setNotice(NAME_FIRST);
      nameRef.current?.focus();
      return;
    }
    setNotice("");
    creds.current = { name: typedName, pin, releaseCode: asking && releaseCode.trim() ? releaseCode.trim() : null };
    void runStart(creds.current);
  };

  const changePin = (value: string) => {
    setPin(value);
    if (passkey || value.length !== PIN_LENGTH) return;
    if (!typedName) {
      setPin("");
      setNotice(NAME_FIRST);
      nameRef.current?.focus();
      return;
    }
    setNotice("");
    login.mutate({ name: typedName, pin: value });
  };

  const failure = login.isError ? login.error : pkError;
  const error = notice || (failure ? messageFor(failure) : "");
  const busy = login.isPending || pkBusy;

  return (
    <main className="login-page">
      <header className="login-brand">
        <span className="login-brand__mark" aria-hidden="true">
          <Wallet size={32} strokeWidth={1.75} />
        </span>
        <h1>Finanças</h1>
        <p className="login-brand__tag">Dinheiro do casal, em ordem</p>
      </header>
      {passkey && step === 2 ? (
        <section className="login-step" aria-labelledby="login-step-title">
          <h2 id="login-step-title">Confirme neste aparelho</h2>
          <p role="alert" className="login-error">
            {cancelled ? CANCELLED_TEXT : ""}
          </p>
          {cancelled ? <p className="login-hint">{NEW_DEVICE_HINT}</p> : null}
          <div className="login-actions">
            <Button block variant="primary" disabled={busy} onClick={confirmHere}>
              Usar Face ID / digital / Windows Hello
            </Button>
            <Button
              block
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setCancelled(false);
                backToStart(null);
              }}
            >
              Voltar
            </Button>
          </div>
        </section>
      ) : (
        <section aria-labelledby="login-title">
          <h2 id="login-title" className="visually-hidden">
            Entrar
          </h2>
          <div className="login-name">
            <label htmlFor="login-name">Seu nome</label>
            <input
              ref={nameRef}
              id="login-name"
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="words"
              autoCorrect="off"
              spellCheck={false}
              maxLength={80}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (notice) setNotice("");
              }}
            />
          </div>
          {passkey && asking ? (
            <div className="login-name">
              <label htmlFor="login-release">Código de liberação</label>
              <input
                id="login-release"
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                placeholder="XXXXX-XXXXX"
                maxLength={20}
                value={releaseCode}
                onChange={(e) => setReleaseCode(e.target.value)}
              />
            </div>
          ) : null}
          <p role="alert" className="login-error">
            {error}
          </p>
          <PinPad value={pin} disabled={busy} onChange={changePin} />
          {passkey ? (
            <div className="login-actions">
              <Button
                block
                variant="primary"
                disabled={busy || pin.length !== PIN_LENGTH || !typedName}
                onClick={submitPasskey}
              >
                Entrar
              </Button>
              {asking ? null : (
                <button type="button" className="login-link" onClick={() => setAsking(true)}>
                  Tenho um código de liberação
                </button>
              )}
            </div>
          ) : null}
        </section>
      )}
    </main>
  );
}
