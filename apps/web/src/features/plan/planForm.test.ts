import { describe, expect, it } from "vitest";
import { PLANILHA_DEFAULTS } from "./planDefaults";
import { fromForm, MAX_CARDS, toForm } from "./planForm";
import {
  centsToField,
  isoToMonthInput,
  monthInputToIso,
  monthLabel,
  monthLongLabel,
  parseMoneyInput,
  parsePercentInput,
  rateToPercentText,
} from "./planMath";

describe("valores em R$", () => {
  it("converte texto em centavos sem float", () => {
    expect(parseMoneyInput("1.234,56")).toBe(123456);
    expect(parseMoneyInput("3.500,50")).toBe(350050);
    expect(parseMoneyInput("12")).toBe(1200);
    expect(parseMoneyInput("R$ 12,5")).toBe(1250);
    expect(parseMoneyInput(" 0,01 ")).toBe(1);
  });

  it("aceita zero, recusa lixo e negativo quando não é permitido", () => {
    expect(parseMoneyInput("0")).toBe(0);
    expect(parseMoneyInput("0,00")).toBe(0);
    expect(parseMoneyInput("R$ 0")).toBe(0);
    expect(parseMoneyInput("abc")).toBeNull();
    expect(parseMoneyInput("")).toBeNull();
    expect(parseMoneyInput("1,234")).toBeNull();
    expect(parseMoneyInput("-10,00")).toBeNull();
  });

  it("aceita negativo só quando o campo permite (saldo em conta)", () => {
    expect(parseMoneyInput("-10,00", true)).toBe(-1000);
    expect(parseMoneyInput("-0", true)).toBe(0);
  });

  it("volta de centavos para texto de campo", () => {
    expect(centsToField(2200000)).toBe("22000,00");
    expect(centsToField(1)).toBe("0,01");
    expect(centsToField(-1050)).toBe("-10,50");
  });
});

describe("taxa ao mês", () => {
  it("converte % em taxa decimal exata", () => {
    expect(parsePercentInput("3,45")).toBe("0.0345");
    expect(parsePercentInput("2,9")).toBe("0.029");
    expect(parsePercentInput("0,5")).toBe("0.005");
    expect(parsePercentInput("10")).toBe("0.1");
    expect(parsePercentInput("0")).toBe("0");
    expect(parsePercentInput("100")).toBe("1");
    expect(parsePercentInput("3,45%")).toBe("0.0345");
  });

  it("recusa fora de 0 a 100% e texto que não é número", () => {
    expect(parsePercentInput("101")).toBeNull();
    expect(parsePercentInput("3,456")).toBeNull();
    expect(parsePercentInput("abc")).toBeNull();
    expect(parsePercentInput("")).toBeNull();
  });

  it("mostra a taxa guardada como % sem passar por float", () => {
    expect(rateToPercentText("0.0345")).toBe("3,45");
    expect(rateToPercentText("0.03")).toBe("3");
    expect(rateToPercentText("0.005")).toBe("0,5");
    expect(rateToPercentText("0.1")).toBe("10");
    expect(rateToPercentText("1")).toBe("100");
    expect(rateToPercentText("0")).toBe("0");
  });
});

describe("meses", () => {
  it("converte AAAA-MM para o dia 1 e de volta", () => {
    expect(monthInputToIso("2026-12")).toBe("2026-12-01");
    expect(monthInputToIso("2026-13")).toBeNull();
    expect(monthInputToIso("")).toBeNull();
    expect(isoToMonthInput("2026-12-01")).toBe("2026-12");
  });

  it("rótulos curto e por extenso", () => {
    expect(monthLabel("2027-04-01")).toBe("abr/27");
    expect(monthLongLabel("2027-04-01")).toBe("abril de 2027");
    expect(monthLongLabel("2026-12-01")).toBe("dezembro de 2026");
  });
});

describe("formulário", () => {
  it("ida e volta: as premissas da planilha não mudam", () => {
    const result = fromForm(toForm(PLANILHA_DEFAULTS));
    expect("value" in result).toBe(true);
    if ("value" in result) expect(result.value).toEqual(PLANILHA_DEFAULTS);
  });

  it("aponta o campo errado e não devolve valor", () => {
    const form = toForm(PLANILHA_DEFAULTS);
    const result = fromForm({ ...form, months: "0", loanRatePercent: "150", salary: "x" });
    expect("errors" in result).toBe(true);
    if ("errors" in result) {
      expect(result.errors.months).toBeTruthy();
      expect(result.errors.loanRatePercent).toBeTruthy();
      expect(result.errors.salary).toBeTruthy();
    }
  });

  it("amortização inicial não pode passar do saldo devedor", () => {
    const form = toForm(PLANILHA_DEFAULTS);
    const result = fromForm({ ...form, initialAmortization: "30.000,00" });
    expect("errors" in result && result.errors.initialAmortization).toBeTruthy();
  });

  it("limita a 20 parcelas de cartão e exige nome e parcela válidos", () => {
    const form = toForm(PLANILHA_DEFAULTS);
    const many = Array.from({ length: MAX_CARDS + 1 }, () => ({
      name: "X",
      installment: "10,00",
      count: "1",
      firstMonth: "1",
    }));
    const tooMany = fromForm({ ...form, cards: many });
    expect("errors" in tooMany && tooMany.errors.cards).toBeTruthy();

    const bad = fromForm({
      ...form,
      cards: [{ name: " ", installment: "x", count: "0", firstMonth: "0" }],
    });
    expect("errors" in bad).toBe(true);
    if ("errors" in bad) {
      expect(bad.errors["cards.0.name"]).toBeTruthy();
      expect(bad.errors["cards.0.installment"]).toBeTruthy();
      expect(bad.errors["cards.0.count"]).toBeTruthy();
      expect(bad.errors["cards.0.firstMonth"]).toBeTruthy();
    }
  });

  it("saldo em conta negativo é aceito", () => {
    const result = fromForm({ ...toForm(PLANILHA_DEFAULTS), cashNow: "-250,00" });
    expect("value" in result && result.value.cash_now_cents).toBe(-25000);
  });
});
