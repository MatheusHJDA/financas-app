import { act, cleanup, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logout = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../AuthProvider", () => ({ useAuth: () => ({ logout }) }));

import { useAwayLogout } from "../useAwayLogout";

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter initialEntries={["/lancar?meta=4"]}>
    {children}
    <Where />
  </MemoryRouter>
);

const visit = (state: "hidden" | "visible") => {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  logout.mockClear();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useAwayLogout", () => {
  it("volta depois de 5 min e 1 s: sai e vai ao login com a rota atual", async () => {
    renderHook(() => useAwayLogout(true), { wrapper });
    act(() => visit("hidden"));
    vi.advanceTimersByTime(5 * 60_000 + 1000);
    await act(async () => visit("visible"));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("where").textContent).toBe("/login?next=%2Flancar%3Fmeta%3D4");
  });

  it("volta com 4 min: não sai", async () => {
    renderHook(() => useAwayLogout(true), { wrapper });
    act(() => visit("hidden"));
    vi.advanceTimersByTime(4 * 60_000);
    await act(async () => visit("visible"));
    expect(logout).not.toHaveBeenCalled();
  });

  it("desligado nunca sai", async () => {
    renderHook(() => useAwayLogout(false), { wrapper });
    act(() => visit("hidden"));
    vi.advanceTimersByTime(60 * 60_000);
    await act(async () => visit("visible"));
    expect(logout).not.toHaveBeenCalled();
  });
});

