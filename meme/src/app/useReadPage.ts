import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./client";
import { latestRequest } from "./latestRequest";
export interface ReadPage<T> {
  items: T[];
  nextCursor: string | null;
  asOf: number;
  throughAt: number;
  viewerFid?: number;
}
/** Mounted per account/tab. Old responses cannot publish into a replacement view. */
export function useReadPage<T>(path: string, viewerFid?: number | null) {
  const [items, setItems] = useState<T[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [asOf, setAsOf] = useState<number | null>(null);
  const requests = useRef(latestRequest()),
    pending = useRef(false),
    next = useRef<string | null>(null),
    mounted = useRef(false),
    generation = useRef(0),
    lastReset = useRef(true);
  async function load(reset = false) {
    if (!mounted.current || pending.current || (!reset && !next.current))
      return;
    const version = ++generation.current;
    lastReset.current = reset;
    pending.current = true;
    setLoading(true);
    setError(null);
    const after = reset ? null : next.current;
    await requests.current.run(
      (signal) =>
        api(
          path + (after ? "?cursor=" + encodeURIComponent(after) : ""),
          undefined,
          "GET",
          signal,
        ) as Promise<ReadPage<T>>,
      (page) => {
        if (viewerFid != null && page.viewerFid !== viewerFid) {
          // Another tab may have changed the server session. Never show its rewards.
          setItems([]);
          next.current = null;
          setCursor(null);
          setError("Account changed. Reconnect to continue.");
          return;
        }
        setItems((previous) =>
          reset ? page.items : [...previous, ...page.items],
        );
        next.current = page.nextCursor;
        setCursor(page.nextCursor);
        setAsOf(page.asOf);
      },
      (error) => {
        if (error instanceof ApiError && [401, 403].includes(error.status)) {
          setItems([]);
          next.current = null;
          setCursor(null);
          setAsOf(null);
          setError("Sign in again to continue.");
        } else setError("Couldn’t load this page. Try again.");
      },
    );
    if (version !== generation.current) return;
    pending.current = false;
    if (mounted.current) setLoading(false);
  }
  useEffect(() => {
    mounted.current = true;
    void load(true);
    return () => {
      mounted.current = false;
      generation.current++;
      pending.current = false;
      requests.current.cancel();
    };
  }, [path]);
  return {
    items,
    hasMore: cursor !== null,
    loading,
    error,
    asOf,
    more: () => load(),
    refresh: () => load(true),
    retry: () => load(lastReset.current),
  };
}
