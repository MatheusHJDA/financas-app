import { describe, expect, it } from "vitest";
import { dueBadge, todayInSP } from "./dueStatus";

describe("todayInSP", () => {
  it("usa o dia de São Paulo, não o do aparelho", () => {
    // 15/11 às 01:30 UTC ainda é 14/11 em São Paulo (UTC−3)
    expect(todayInSP(new Date("2026-11-15T01:30:00Z"))).toBe("2026-11-14");
    expect(todayInSP(new Date("2026-11-15T03:30:00Z"))).toBe("2026-11-15");
  });
});

describe("dueBadge", () => {
  const now = new Date("2026-11-14T15:00:00Z"); // 14/11 em São Paulo

  it("data passada é Atrasada", () => {
    expect(dueBadge("2026-11-13", now)).toEqual({ label: "Atrasada", tone: "late" });
    expect(dueBadge("2026-10-01", now)).toEqual({ label: "Atrasada", tone: "late" });
  });

  it("hoje, amanhã e em N dias", () => {
    expect(dueBadge("2026-11-14", now)).toEqual({ label: "Vence hoje", tone: "soon" });
    expect(dueBadge("2026-11-15", now)).toEqual({ label: "Vence amanhã", tone: "soon" });
    expect(dueBadge("2026-11-16", now)).toEqual({ label: "Vence em 2 dias", tone: "soon" });
    expect(dueBadge("2026-11-29", now)).toEqual({ label: "Vence em 15 dias", tone: "ok" });
  });

  it("atravessa a virada de mês e de ano", () => {
    const ny = new Date("2026-12-30T15:00:00Z");
    expect(dueBadge("2027-01-02", ny)).toEqual({ label: "Vence em 3 dias", tone: "soon" });
  });

  it("a virada do dia segue São Paulo", () => {
    // 15/11 01:30 UTC = 14/11 22:30 em SP: vencer em 14/11 ainda é "hoje"
    const late = new Date("2026-11-15T01:30:00Z");
    expect(dueBadge("2026-11-14", late)).toEqual({ label: "Vence hoje", tone: "soon" });
  });

  it("data inválida não quebra: sem selo", () => {
    expect(dueBadge("quando der", now)).toBeNull();
  });
});
