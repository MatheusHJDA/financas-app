import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, initTheme, readTheme, saveTheme, THEME_KEY } from "../theme";

function addMeta(): HTMLMetaElement {
  const m = document.createElement("meta");
  m.name = "theme-color";
  m.content = "#15803d";
  document.head.appendChild(m);
  return m;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});
afterEach(() => {
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("theme", () => {
  it("usa a chave finance.theme", () => {
    expect(THEME_KEY).toBe("finance.theme");
  });

  it("applyTheme grava data-theme claro/escuro e remove no automático", () => {
    const root = document.documentElement;
    applyTheme("dark");
    expect(root.getAttribute("data-theme")).toBe("dark");
    applyTheme("light");
    expect(root.getAttribute("data-theme")).toBe("light");
    applyTheme("auto");
    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  it("readTheme devolve auto sem valor ou com valor inválido", () => {
    expect(readTheme()).toBe("auto");
    localStorage.setItem(THEME_KEY, "roxo");
    expect(readTheme()).toBe("auto");
    localStorage.setItem(THEME_KEY, "dark");
    expect(readTheme()).toBe("dark");
  });

  it("saveTheme lembra a escolha e initTheme a reaplica", () => {
    saveTheme("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    initTheme();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("sobrevive a localStorage que lança", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    expect(readTheme()).toBe("auto");
    expect(() => saveTheme("light")).not.toThrow();
    expect(() => initTheme()).not.toThrow();
  });

  it("atualiza a meta theme-color", () => {
    const m = addMeta();
    applyTheme("dark");
    expect(m.content).toBe("#0d1110");
    applyTheme("light");
    expect(m.content).toBe("#15803d");
  });

  it("automático segue o esquema do sistema na meta theme-color", () => {
    const m = addMeta();
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    applyTheme("auto");
    expect(m.content).toBe("#0d1110");
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    applyTheme("auto");
    expect(m.content).toBe("#15803d");
  });

  it("funciona sem meta theme-color", () => {
    expect(() => applyTheme("dark")).not.toThrow();
  });
});
