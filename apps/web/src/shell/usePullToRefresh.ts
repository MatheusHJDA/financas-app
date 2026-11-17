import { useEffect, useRef, useState } from "react";

const MAX_DISTANCE = 120;
const FORM_FIELDS = "textarea, input, select, [contenteditable]";

/** O toque começou num campo ou numa área que rola por conta própria (e não está no topo): não é puxar a página. */
function startsInScrollable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(FORM_FIELDS)) return true;
  for (let el: Element | null = target; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    const style = getComputedStyle(el);
    const y = /(auto|scroll)/.test(style.overflowY);
    const x = /(auto|scroll)/.test(style.overflowX);
    if (y && el.scrollHeight > el.clientHeight && el.scrollTop > 0) return true;
    if (x && el.scrollWidth > el.clientWidth) return true;
  }
  return false;
}

interface Options {
  enabled: boolean;
  onRefresh: () => Promise<void>;
  /** Puxão (em px do dedo) a partir do qual solta e atualiza. */
  threshold?: number;
}

/** Puxar para atualizar: só no topo da página, sem diálogo aberto. `distance` já traz a resistência (metade, teto 120px). */
export function usePullToRefresh({ enabled, onRefresh, threshold = 72 }: Options) {
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [armed, setArmed] = useState(false);
  const refresh = useRef(onRefresh);
  useEffect(() => {
    refresh.current = onRefresh;
  });
  const busy = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let startY: number | null = null;
    let startX = 0;
    let pulled = 0;
    const reset = () => {
      startY = null;
      pulled = 0;
      setDistance(0);
      setArmed(false);
    };

    const onStart = (e: TouchEvent) => {
      const blocked =
        busy.current ||
        window.scrollY > 0 ||
        document.querySelector('[role="dialog"]') !== null ||
        startsInScrollable(e.target);
      startY = blocked || e.touches.length !== 1 ? null : e.touches[0].clientY;
      startX = e.touches[0]?.clientX ?? 0;
      pulled = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      if (window.scrollY > 0 || e.touches.length !== 1) {
        reset();
        return;
      }
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;
      if (Math.abs(dx) > Math.abs(dy)) {
        reset();
        return;
      }
      pulled = Math.max(0, dy);
      setDistance(Math.min(pulled / 2, MAX_DISTANCE));
      setArmed(pulled >= threshold);
    };
    const onCancel = () => {
      if (startY !== null) reset();
    };
    const onEnd = () => {
      if (startY === null) return;
      startY = null;
      setArmed(false);
      if (pulled < threshold) {
        setDistance(0);
        return;
      }
      busy.current = true;
      setRefreshing(true);
      setDistance(0);
      let run: Promise<void>;
      try {
        run = refresh.current();
      } catch (err) {
        run = Promise.reject(err);
      }
      void run
        .catch(() => {})
        .finally(() => {
          busy.current = false;
          setRefreshing(false);
        });
    };

    const opts = { passive: true } as const;
    window.addEventListener("touchstart", onStart, opts);
    window.addEventListener("touchmove", onMove, opts);
    window.addEventListener("touchend", onEnd, opts);
    window.addEventListener("touchcancel", onCancel, opts);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onCancel);
    };
  }, [enabled, threshold]);

  return { distance, refreshing, armed };
}
