export interface NoticeValue {
  kind: "ok" | "error";
  text: string;
}

/** Resultado de uma ação. A região `aria-live` fica sempre na tela para ser anunciada. */
export function Notice({ notice }: { notice: NoticeValue | null }) {
  return (
    <div aria-live="polite" className="admin-notice">
      {notice ? (
        <p className={notice.kind === "error" ? "admin-notice--error" : "admin-notice--ok"}>{notice.text}</p>
      ) : null}
    </div>
  );
}
