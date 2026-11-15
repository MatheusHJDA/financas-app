import { describe, expect, it } from "vitest";
import { formatShare } from "./formatShare";

describe("formatShare", () => {
  it("formata pontos-base em percentual pt-BR sem float", () => {
    expect(formatShare(8550)).toBe("85,5%");
    expect(formatShare(1450)).toBe("14,5%");
    expect(formatShare(10000)).toBe("100%");
    expect(formatShare(2500)).toBe("25%");
  });

  it("mantém duas casas quando preciso e trata valores pequenos", () => {
    expect(formatShare(8505)).toBe("85,05%");
    expect(formatShare(5)).toBe("0,05%");
    expect(formatShare(0)).toBe("0%");
  });
});
