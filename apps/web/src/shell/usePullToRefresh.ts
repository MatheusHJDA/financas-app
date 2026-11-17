import { useEffect, useRef, useState } from "react";

const MAX_DISTANCE = 120;

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
  const refresh = useRef(onRefresh);
  useEffect(() => {
    refresh.current = onRefresh;
  });
  const busy = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let startY: number | null = null;
    let pulled = 0;

    const onStart = (e: TouchEvent) => {
      const blocked =
        busy.current || window.scrollY > 0 || document.querySelector('[role="dialog"]') !== null;
      startY = blocked || e.touches.length !== 1 ? null : e.touches[0].clientY;
      pulled = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      if (window.scrollY > 0 || e.touches.length !== 1) {
        startY = null;
        setDistance(0);
        return;
      }
      pulled = Math.max(0, e.touches[0].clientY - startY);
      setDistance(Math.min(pulled / 2, MAX_DISTANCE));
    };
    const onEnd = () => {
      if (startY === null) return;
      startY = null;
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
    window.addEventListener("touchcancel", onEnd, opts);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled, threshold]);

  return { distance, refreshing };
}
