import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Wallet } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "./AuthProvider";
import { deviceLabel } from "./deviceLabel";
import "./login.css";
import { PIN_LENGTH, PinPad } from "./PinPad";

const NAME_FIRST = "Digite seu nome antes do PIN.";

class LoginError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Mesma mensagem para nome errado, PIN errado ou conta travada: não revela o que falhou.
function messageFor(error: unknown): string {
  if (error instanceof LoginError) {
    if (error.status === 401) return "Não foi possível entrar. Confira o nome e o PIN.";
    if (error.status === 429) return "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
  }
  return "Não foi possível entrar. Verifique a conexão e tente de novo.";
}

export function LoginPage() {
  const { me, setMe } = useAuth();
  const navigate = useNavigate();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [notice, setNotice] = useState("");

  const login = useMutation({
    mutationFn: async (body: { name: string; pin: string }) => {
      const { data, response } = await api.POST("/auth/login", {
        body: { ...body, device_label: deviceLabel() },
      });
      if (!data) throw new LoginError(response.status, `HTTP ${response.status}`);
      return data;
    },
    onSuccess: (data) => {
      setMe(data);
      void navigate("/", { replace: true });
    },
    onError: () => setPin(""),
  });

  if (me) return <Navigate to="/" replace />;

  const changePin = (next: string) => {
    setPin(next);
    if (next.length !== PIN_LENGTH) return;
    const typed = name.trim();
    if (!typed) {
      setPin("");
      setNotice(NAME_FIRST);
      nameRef.current?.focus();
      return;
    }
    setNotice("");
    login.mutate({ name: typed, pin: next });
  };

  const error = notice || (login.isError ? messageFor(login.error) : "");

  return (
    <main className="login-page">
      <header className="login-brand">
        <span className="login-brand__mark" aria-hidden="true">
          <Wallet size={32} strokeWidth={1.75} />
        </span>
        <h1>Finanças</h1>
        <p className="login-brand__tag">Dinheiro do casal, em ordem</p>
      </header>
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
        <p role="alert" className="login-error">
          {error}
        </p>
        <PinPad value={pin} disabled={login.isPending} onChange={changePin} />
      </section>
    </main>
  );
}
