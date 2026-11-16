import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { todayIso, yesterdayIso } from "./dates";

// "Hoje" e "ontem" seguem São Paulo (como a API), não o fuso do aparelho.
describe("todayIso / yesterdayIso", () => {
  beforeEach(() => {
    vi.stubEnv("TZ", "Pacific/Auckland"); // aparelho muito à frente de SP
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("às 22h30 de 30/11 em São Paulo ainda é 30/11 (ontem 29/11), mesmo com o aparelho em 01/12", () => {
    const instant = new Date("2026-12-01T01:30:00Z");
    expect(todayIso(instant)).toBe("2026-11-30");
    expect(yesterdayIso(instant)).toBe("2026-11-29");
  });

  it("ontem atravessa a virada de mês e de ano", () => {
    expect(yesterdayIso(new Date("2026-12-01T03:30:00Z"))).toBe("2026-11-30");
    expect(yesterdayIso(new Date("2027-01-01T12:00:00Z"))).toBe("2026-12-31");
  });

  it("ontem em ano bissexto", () => {
    expect(yesterdayIso(new Date("2028-03-01T12:00:00Z"))).toBe("2028-02-29");
  });
});
