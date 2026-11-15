import { useCallback, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { Sheet, SparkleIcon } from "../../ui";
import { ErrorState } from "../../ui/States";
import "./chat.css";
import { Composer } from "./Composer";
import { ManualEntry } from "./ManualEntry";
import { ResultGroup } from "./ResultGroup";
import { IngestError, sendIngest } from "./sendIngest";
import type { IngestResult } from "./types";
import { useChatData } from "./useChatData";
import { useDraftController } from "./useDraftController";

type ChatMessage =
  | { id: number; role: "user"; text: string; fileName: string | null }
  | { id: number; role: "ai"; result: IngestResult }
  | { id: number; role: "error" | "info"; text: string };

type NewMessage = ChatMessage extends infer M ? (M extends { id: number } ? Omit<M, "id"> : never) : never;

/** Tela "Lançar" (/lancar): chat com a IA + lançamento à mão em painel (Sheet). */
export default function ChatPage() {
  const { me, setMe } = useAuth();
  const data = useChatData();
  const controller = useDraftController();
  const { register } = controller;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [manual, setManual] = useState<{ open: boolean; reason: string | null }>({ open: false, reason: null });
  const sendingRef = useRef(false);
  const nextId = useRef(1);

  const closeManual = useCallback(() => setManual({ open: false, reason: null }), []);

  const owner = me?.owner ?? "AMBOS";
  const push = useCallback((m: NewMessage) => {
    setMessages((prev) => [...prev, { ...m, id: nextId.current++ } as ChatMessage]);
  }, []);

  const send = useCallback(
    async ({ text, file }: { text: string; file: File | null }): Promise<boolean> => {
      if (sendingRef.current) return false;
      sendingRef.current = true;
      setSending(true);
      setProgress(file ? 0 : null);
      push({ role: "user", text: text.trim(), fileName: file?.name ?? null });
      try {
        const result = await sendIngest({
          text,
          file,
          onProgress: setProgress,
          onUnauthorized: () => setMe(null),
        });
        register(result);
        push({ role: "ai", result });
        return true;
      } catch (e) {
        const err = e instanceof IngestError ? e : new IngestError("http", "Não foi possível enviar agora. Tente de novo.");
        push({ role: "error", text: err.message });
        if (err.openManual) setManual({ open: true, reason: err.message });
        return false;
      } finally {
        sendingRef.current = false;
        setSending(false);
        setProgress(null);
      }
    },
    [push, register, setMe],
  );

  return (
    <section className="chat" aria-label="Chat de lançamentos">
      <h1 className="sr-only">Chat</h1>

      {data.isError ? <ErrorState message="Não consegui carregar contas e categorias." onRetry={data.retry} /> : null}

      <div className="chat-log" role="log" aria-live="polite" aria-label="Conversa">
        {messages.length === 0 ? (
          <div className="chat-welcome">
            <span className="chat-welcome__icon" aria-hidden="true">
              <SparkleIcon size={32} />
            </span>
            <p className="chat-welcome__title">Mande o que você gastou ou recebeu</p>
            <p className="chat-welcome__hint">
              Escreva, tire uma foto do comprovante ou envie um PDF. Nada é lançado sem você confirmar.
            </p>
          </div>
        ) : null}

        {messages.map((m) => {
          switch (m.role) {
            case "user":
              return (
                <div key={m.id} className="bubble bubble--user">
                  {m.text ? <p>{m.text}</p> : null}
                  {m.fileName ? <p className="muted">Anexo: {m.fileName}</p> : null}
                </div>
              );
            case "ai":
              return (
                <div key={m.id} className="bubble bubble--ai">
                  <span className="bubble__avatar" aria-hidden="true">
                    <SparkleIcon size={18} />
                  </span>
                  <ResultGroup
                    result={m.result}
                    controller={controller}
                    accounts={data.accounts}
                    categories={data.categories}
                    fallbackOwner={owner}
                  />
                </div>
              );
            case "error":
              return (
                <div key={m.id} className="bubble bubble--error" role="alert">
                  <p>{m.text}</p>
                </div>
              );
            case "info":
              return (
                <div key={m.id} className="bubble bubble--info" role="status">
                  <p>✓ {m.text}</p>
                </div>
              );
          }
        })}
      </div>

      <Sheet open={manual.open} title="Lançar à mão" onClose={closeManual}>
        <ManualEntry
          key={owner}
          accounts={data.accounts}
          categories={data.categories}
          owner={owner}
          loading={data.isLoading}
          loadError={data.isError}
          onRetry={data.retry}
          reason={manual.reason}
          onCancel={closeManual}
          onCreated={(summary) => {
            closeManual();
            push({ role: "info", text: `Lançamento criado — ${summary}` });
          }}
        />
      </Sheet>

      <Composer
        sending={sending}
        progress={progress}
        onSend={send}
        onManual={() => setManual((m) => ({ open: true, reason: m.reason }))}
      />
    </section>
  );
}
