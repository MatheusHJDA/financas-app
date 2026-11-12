import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { components } from "../api/schema";
import { EmptyState, ErrorState, LoadingState } from "../ui/States";
import { useAuth } from "./AuthProvider";
import { deviceLabel } from "./deviceLabel";
import { PIN_LENGTH, PinPad } from "./PinPad";

type LoginUser = components["schemas"]["LoginUser"];

class LoginError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function messageFor(error: unknown): string {
  if (error instanceof LoginError) {
    if (error.status === 401) return "PIN incorreto. Confira os 6 dígitos e tente de novo.";
    if (error.status === 423) return "Acesso bloqueado por tentativas erradas. Aguarde cerca de 15 minutos e tente de novo.";
  }
  return "Não foi possível entrar. Verifique a conexão e tente de novo.";
}

async function fetchUsers(): Promise<LoginUser[]> {
  const { data, response } = await api.GET("/auth/users");
  if (!data) throw new Error(`HTTP ${response.status}`);
  return data;
}

export function LoginPage() {
  const { me, setMe } = useAuth();
  const navigate = useNavigate();
  const [user, setUser] = useState<LoginUser | null>(null);
  const [pin, setPin] = useState("");
  const users = useQuery({ queryKey: ["login-users"], queryFn: fetchUsers, retry: false });

  const login = useMutation({
    mutationFn: async ({ userId, pin }: { userId: number; pin: string }) => {
      const { data, response } = await api.POST("/auth/login", {
        body: { user_id: userId, pin, device_label: deviceLabel() },
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
    if (user && next.length === PIN_LENGTH) login.mutate({ userId: user.id, pin: next });
  };

  let body;
  if (users.isPending) body = <LoadingState />;
  else if (users.isError) body = <ErrorState message="Não foi possível carregar os usuários." onRetry={() => void users.refetch()} />;
  else if (users.data.length === 0) body = <EmptyState title="Nenhum usuário cadastrado" hint="Peça ao administrador para criar os acessos." />;
  else if (!user) {
    body = (
      <section aria-labelledby="who">
        <h2 id="who" className="login-sub">
          Quem está entrando?
        </h2>
        <ul className="user-list">
          {users.data.map((u) => (
            <li key={u.id}>
              <button type="button" className="user-btn" onClick={() => setUser(u)}>
                {u.name}
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  } else {
    body = (
      <section aria-labelledby="pin-title">
        <h2 id="pin-title" className="login-sub">
          Olá, {user.name}. Digite seu PIN
        </h2>
        <p role="alert" className="form-error">
          {login.isError ? messageFor(login.error) : ""}
        </p>
        <PinPad value={pin} disabled={login.isPending} onChange={changePin} />
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            setUser(null);
            setPin("");
            login.reset();
          }}
        >
          Não sou {user.name}
        </button>
      </section>
    );
  }

  return (
    <main className="login">
      <h1>Finanças</h1>
      {body}
    </main>
  );
}
