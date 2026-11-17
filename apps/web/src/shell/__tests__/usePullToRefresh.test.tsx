import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PullIndicator } from "../PullIndicator";
import { usePullToRefresh } from "../usePullToRefresh";

function Probe({ enabled, onRefresh }: { enabled: boolean; onRefresh: () => Promise<void> }) {
  const { distance, refreshing } = usePullToRefresh({ enabled, onRefresh });
  return <PullIndicator distance={distance} refreshing={refreshing} />;
}

function touch(type: string, y: number) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  const point = { clientX: 10, clientY: y };
  Object.assign(ev, { touches: type === "touchend" ? [] : [point], changedTouches: [point] });
  act(() => {
    window.dispatchEvent(ev);
  });
}

function pull(px: number) {
  touch("touchstart", 100);
  touch("touchmove", 100 + px / 2);
  touch("touchmove", 100 + px);
  touch("touchend", 100 + px);
}

function setScroll(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
}

afterEach(() => {
  cleanup();
  setScroll(0);
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("usePullToRefresh", () => {
  it("puxar 100px no topo atualiza uma vez e mostra 'Atualizando…'", async () => {
    let done: () => void = () => {};
    const onRefresh = vi.fn(() => new Promise<void>((r) => (done = r)));
    render(<Probe enabled onRefresh={onRefresh} />);
    pull(100);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toBe("Atualizando…");
    await act(async () => done());
    await waitFor(() => expect(screen.queryByText("Atualizando…")).toBeNull());
  });

  it("puxar 40px não atualiza", () => {
    const onRefresh = vi.fn(async () => {});
    render(<Probe enabled onRefresh={onRefresh} />);
    pull(40);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("com a página rolada não atualiza", () => {
    setScroll(50);
    const onRefresh = vi.fn(async () => {});
    render(<Probe enabled onRefresh={onRefresh} />);
    pull(100);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("com um diálogo aberto não atualiza", () => {
    document.body.insertAdjacentHTML("beforeend", '<div role="dialog"></div>');
    const onRefresh = vi.fn(async () => {});
    render(<Probe enabled onRefresh={onRefresh} />);
    pull(100);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("desativado não registra listeners", () => {
    const add = vi.spyOn(window, "addEventListener");
    const onRefresh = vi.fn(async () => {});
    render(<Probe enabled={false} onRefresh={onRefresh} />);
    expect(add.mock.calls.filter(([t]) => String(t).startsWith("touch"))).toHaveLength(0);
    pull(100);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
