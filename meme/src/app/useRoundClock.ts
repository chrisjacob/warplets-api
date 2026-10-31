import { useEffect, useState } from "react";
import { qaEnabled } from "./qaMode";
/** One timer at the next boundary, rather than a per-second render loop.
 * Server time anchors the display; the API remains authoritative for voting. */
export function useRoundClock(
  serverTime?: number,
  opensAt?: number,
  closesAt?: number,
) {
  const [now, setNow] = useState(serverTime ?? Date.now());
  useEffect(() => {
    const base = serverTime ?? Date.now(),
      started = performance.now();
    if (qaEnabled) {
      setNow(base);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      const current = base + performance.now() - started;
      setNow(current);
      const next = [opensAt, closesAt]
        .filter((at): at is number => at != null && at > current)
        .sort((a, b) => a - b)[0];
      if (next != null)
        timer = setTimeout(update, Math.min(2147483647, next - current + 1));
    };
    update();
    return () => clearTimeout(timer);
  }, [serverTime, opensAt, closesAt]);
  return now;
}
