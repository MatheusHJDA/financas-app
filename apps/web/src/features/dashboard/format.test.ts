import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentMonth, todayIso } from "./format";

// "Hoje" e "mês corrente" seguem São Paulo (como a API), não o fuso do aparelho.
describe("todayIso / currentMonth", () => {
  beforeEach(() => {
    vi.stubEnv("TZ", "Pacific/Auckland"); // aparelho muito à frente de SP
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("às 22h30 de 30/11 em São Paulo ainda é 30/11 e novembro, mesmo com o aparelho já em 01/12", () => {
    const instant = new Date("2026-12-01T01:30:00Z"); // 30/11 22:30 em SP; 01/12 14:30 em Auckland
    expect(todayIso(instant)).toBe("2026-11-30");
    expect(currentMonth(instant)).toBe("2026-11");
  });

  it("à 0h30 de 01/12 em São Paulo já é dezembro", () => {
    const instant = new Date("2026-12-01T03:30:00Z");
    expect(todayIso(instant)).toBe("2026-12-01");
    expect(currentMonth(instant)).toBe("2026-12");
  });
});
