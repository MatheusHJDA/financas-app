import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PullIndicator } from "../PullIndicator";
import { usePullToRefresh } from "../usePullToRefresh";

function Probe({ enabled, onRefresh }: { enabled: boolean; onRefresh: () => Promise<void> }) {
  const { distance, refreshing, armed } = usePullToRefresh({ enabled, onRefresh });
  return <PullIndicator distance={distance} refreshing={refreshing} armed={armed} />;
}

function touch(type: string, y: number, x = 10, target: EventTarget = window) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  const point = { clientX: x, clientY: y };
  Object.assign(ev, { touches: type === "touchend" || type === "touchcancel" ? [] : [point], changedTouches: [point] });
  act(() => {
    target.dispatchEvent(ev);
  });
}

function pull(px: number, target: EventTarget = window) {
  touch("touchstart", 100, 10, target);
  touch("touchmove", 100 + px / 2, 10, target);
  touch("touchmove", 100 + px, 10, target);
  touch("touchend", 100 + px, 10, target);
}

const status = () => screen.getByRole("status");

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

  it("toque começando num textarea não atualiza", () => {
    document.body.insertAdjacentHTML("beforeend", "<textarea></textarea>");
    const onRefresh = vi.fn(async () => {});
    render(<Probe enabled onRefresh={onRefresh} />);
    pull(100, document.querySelector("textarea")!);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("toque dentro de elemento rolável já rolado não atualiza", () => {
    document.body.insertAdjacentHTML("beforeend", '<div id="box" style="overflow-y:auto"><p id="in">x</p></div>');
    const box = document.getElementById("box")!;
    Object.defineProperty(box, "scrollTop", { value: 30, configurable: true });
    Object.defineProperty(box, "scrollHeight", { value: 500, configurable: true });
    Object.defineProperty(box, "clientHeight", { value: 100, configurable: true });
    const onRefresh = vi.fn(async () => {});
    render(<Probe enabled onRefresh={onRefresh} />);
    pull(100, document.getElementById("in")!);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("gesto diagonal/horizontal é abortado", () => {
    const onRefresh = vi.fn(async () => {});
    render(<Probe enabled onRefresh={onRefresh} />);
    touch("touchstart", 100, 10);
    touch("touchmove", 130, 150);
    touch("touchmove", 220, 160);
    touch("touchend", 220, 160);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("touchcancel zera o gesto sem atualizar", () => {
    const onRefresh = vi.fn(async () => {});
    render(<Probe enabled onRefresh={onRefresh} />);
    touch("touchstart", 100);
    touch("touchmove", 250);
    touch("touchcancel", 250);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(status().textContent).toBe("");
  });

  it("mostra 'Puxe para atualizar' e, passado o limite, 'Solte para atualizar'", () => {
    render(<Probe enabled onRefresh={vi.fn(async () => {})} />);
    touch("touchstart", 100);
    touch("touchmove", 130);
    expect(status().textContent).toBe("Puxe para atualizar");
    touch("touchmove", 200);
    expect(status().textContent).toBe("Solte para atualizar");
  });

  it("a região de status fica sempre montada", () => {
    render(<Probe enabled onRefresh={vi.fn(async () => {})} />);
    expect(status().textContent).toBe("");
  });
});
