import { api } from "../../api/client";
import type { components } from "../../api/schema";

export type AdminUser = components["schemas"]["AdminUser"];
export type AiCall = components["schemas"]["AiCall"];
export type AiCallPage = components["schemas"]["AiCallPage"];
export type AuditEvent = components["schemas"]["AuditEvent"];
export type AuditPage = components["schemas"]["AuditPage"];
export type SystemStatus = components["schemas"]["SystemStatus"];
export type PushSubscription = components["schemas"]["PushSubscription"];

export const PAGE_SIZE = 20;
export const PIN_LENGTH = 6;

// Chaves das configurações (core/app_settings.py): só estas existem.
export const KEY_DAILY_TIME = "notify.daily_time";
export const KEY_BILL_TIME = "notify.bill_time";
export const KEY_BILL_DAYS = "notify.bill_days_before";

// Prefixo próprio "admin" para todas as consultas desta tela.
export const USERS_KEY = ["admin", "users"] as const;
export const SETTINGS_KEY = ["admin", "settings"] as const;
export const SUBSCRIPTIONS_KEY = ["admin", "push-subscriptions"] as const;
export const SYSTEM_KEY = ["admin", "system"] as const;
export const aiKey = (offset: number) => ["admin", "ai-calls", offset] as const;
export const auditKey = (entity: string, userId: number | null, offset: number) =>
  ["admin", "audit", entity, userId, offset] as const;

export class AdminError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

function need<T>(data: T | undefined, response: Response): T {
  if (data === undefined) throw new AdminError(response.status);
  return data;
}

export async function fetchUsers(): Promise<AdminUser[]> {
  const { data, response } = await api.GET("/admin/users");
  return need(data, response);
}

export async function fetchSettings(): Promise<Record<string, unknown>> {
  const { data, response } = await api.GET("/admin/settings");
  return need(data, response);
}

export async function saveSettings(values: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, response } = await api.PUT("/admin/settings", { body: values });
  return need(data, response);
}

export async function fetchSubscriptions(): Promise<PushSubscription[]> {
  const { data, response } = await api.GET("/admin/push-subscriptions");
  return need(data, response);
}

export async function sendTestNotification(userId: number): Promise<number> {
  const { data, response } = await api.POST("/admin/notifications/test", { body: { user_id: userId } });
  return need(data, response).sent;
}

export async function resetPin(userId: number, newPin: string): Promise<void> {
  const { response } = await api.POST("/admin/users/{id}/reset-pin", {
    params: { path: { id: userId } },
    body: { new_pin: newPin },
  });
  if (!response.ok) throw new AdminError(response.status);
}

export async function revokeSessions(userId: number): Promise<void> {
  const { response } = await api.DELETE("/admin/users/{id}/sessions", { params: { path: { id: userId } } });
  if (!response.ok) throw new AdminError(response.status);
}

export async function fetchAiCalls(offset: number): Promise<AiCallPage> {
  const { data, response } = await api.GET("/admin/ai/calls", { params: { query: { limit: PAGE_SIZE, offset } } });
  return need(data, response);
}

export async function fetchAudit(entity: string, userId: number | null, offset: number): Promise<AuditPage> {
  const query: { entity?: string; user_id?: number; limit: number; offset: number } = { limit: PAGE_SIZE, offset };
  if (entity) query.entity = entity;
  if (userId !== null) query.user_id = userId;
  const { data, response } = await api.GET("/admin/audit", { params: { query } });
  return need(data, response);
}

export async function fetchSystem(): Promise<SystemStatus> {
  const { data, response } = await api.GET("/admin/system");
  return need(data, response);
}

/** Texto para o usuário a partir do erro de uma chamada. */
export function errorText(error: unknown, fallback: string): string {
  if (error instanceof AdminError) {
    if (error.status === 403) return "Você não tem permissão para fazer isso.";
    if (error.status === 404) return "Não encontrado. Atualize a lista e tente de novo.";
  }
  return fallback;
}
