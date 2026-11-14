import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { components } from "../../api/schema";

export type MonthReport = components["schemas"]["MonthReport"];
export type Owner = components["schemas"]["Owner"];

export function monthReportKey(month: string, owner?: Owner) {
  return ["report", month, owner ?? "all"] as const;
}

/** Relatório do mês ("AAAA-MM"). Sem dono = visão do casal. Usado pelo Dashboard (U16) e Relatórios (U21). */
export function useMonthReport(month: string, owner?: Owner): UseQueryResult<MonthReport> {
  return useQuery({
    queryKey: monthReportKey(month, owner),
    queryFn: async () => {
      const { data, response } = await api.GET("/reports/month", {
        params: { query: owner ? { month, owner } : { month } },
      });
      if (!data) throw new Error(`HTTP ${response.status}`);
      return data;
    },
  });
}
