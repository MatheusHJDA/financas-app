import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Clock } from "lucide-react";
import { Button, Card } from "../../ui";
import { ErrorState } from "../../ui/States";
import {
  errorText,
  fetchSettings,
  KEY_BILL_DAYS,
  KEY_BILL_TIME,
  KEY_DAILY_TIME,
  saveSettings,
  SETTINGS_KEY,
} from "./adminApi";
import { Notice, type NoticeValue } from "./Notice";
import { SectionSkeleton } from "./SectionSkeleton";

interface Form {
  dailyTime: string;
  billTime: string;
  billDays: string;
}

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

function fromSettings(values: Record<string, unknown>): Form {
  return {
    dailyTime: String(values[KEY_DAILY_TIME] ?? ""),
    billTime: String(values[KEY_BILL_TIME] ?? ""),
    billDays: String(values[KEY_BILL_DAYS] ?? ""),
  };
}

/** Devolve a mensagem de erro do formulário, ou null se está válido. */
function validate(form: Form): string | null {
  if (!HHMM.test(form.dailyTime)) return "Informe o horário do resumo diário (HH:MM).";
  if (!HHMM.test(form.billTime)) return "Informe o horário do aviso de vencimento (HH:MM).";
  if (!/^[0-9]{1,2}$/.test(form.billDays) || Number(form.billDays) > 10) {
    return "A antecedência deve ser um número inteiro de 0 a 10 dias.";
  }
  return null;
}

export function SettingsSection() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: fetchSettings });
  const [edited, setEdited] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<NoticeValue | null>(null);
  const savingRef = useRef(false);

  if (settings.isLoading) return <SectionSkeleton label="Carregando configurações…" rows={3} />;
  if (settings.isError || !settings.data) {
    return <ErrorState message="Não foi possível carregar as configurações." onRetry={() => void settings.refetch()} />;
  }

  const form = edited ?? fromSettings(settings.data);
  const change = (patch: Partial<Form>) => {
    setEdited({ ...form, ...patch });
    setNotice(null);
  };

  async function submit() {
    if (savingRef.current) return;
    const problem = validate(form);
    if (problem) {
      setNotice({ kind: "error", text: problem });
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const saved = await saveSettings({
        [KEY_DAILY_TIME]: form.dailyTime,
        [KEY_BILL_TIME]: form.billTime,
        [KEY_BILL_DAYS]: Number(form.billDays),
      });
      queryClient.setQueryData(SETTINGS_KEY, saved);
      setEdited(null);
      setNotice({ kind: "ok", text: "Configurações salvas." });
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error, "Não foi possível salvar. Confira os valores e tente de novo.") });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Card title="Horários dos avisos" icon={Clock} className="admin-card--narrow">
      <form
        className="admin-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="admin-field">
          <label htmlFor="set-daily">Horário do resumo diário</label>
          <input
            id="set-daily"
            type="time"
            value={form.dailyTime}
            onChange={(e) => change({ dailyTime: e.target.value })}
          />
        </div>
        <div className="admin-field">
          <label htmlFor="set-bill">Horário do aviso de vencimento</label>
          <input
            id="set-bill"
            type="time"
            value={form.billTime}
            onChange={(e) => change({ billTime: e.target.value })}
          />
        </div>
        <div className="admin-field">
          <label htmlFor="set-days">Avisar vencimentos com antecedência (dias, 0 a 10)</label>
          <input
            id="set-days"
            inputMode="numeric"
            value={form.billDays}
            onChange={(e) => change({ billDays: e.target.value.replace(/[^0-9]/g, "").slice(0, 2) })}
          />
          <p className="muted">Os avisos também saem no dia do vencimento. Horários no fuso de Brasília.</p>
        </div>
        <Notice notice={notice} />
        <Button type="submit" variant="primary" disabled={saving}>
          Salvar configurações
        </Button>
      </form>
    </Card>
  );
}
