/** Discard superseded responses even when a transport ignores cancellation. */
export function latestRequest() {
  let version = 0,
    controller: AbortController | undefined;
  return {
    cancel() {
      version++;
      controller?.abort();
      controller = undefined;
    },
    async run<T>(
      load: (signal: AbortSignal) => Promise<T>,
      success: (value: T) => void,
      failure: (error: unknown) => void,
    ) {
      const current = ++version;
      controller?.abort();
      const active = new AbortController();
      controller = active;
      try {
        const value = await load(active.signal);
        if (current === version && !active.signal.aborted) success(value);
      } catch (error) {
        if (current === version && !active.signal.aborted) failure(error);
      } finally {
        if (current === version) controller = undefined;
      }
    },
  };
}
