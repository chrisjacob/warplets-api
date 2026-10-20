// Only owns the launcher's Worker, timer and loopback relay. Durable source
// budgets, leases, pause and backoff belong to the Worker and are untouched.
export function discoveryLifecycle({ child, relay, terminateChild, onWorkerFailure }) {
  const shutdown = new AbortController();
  let stopping = false, timer;

  function finish(terminate, failed) {
    if (stopping) return false;
    stopping = true;
    clearInterval(timer);
    shutdown.abort();
    // Stop accepting requests before closing existing local relay connections.
    relay?.close();
    relay?.closeAllConnections();
    if (terminate) terminateChild();
    if (failed) onWorkerFailure();
    return true;
  }
  // A clean Worker exit is still unexpected while the launcher is running.
  child.once("exit", () => finish(false, true));
  child.once("error", () => finish(false, true));

  return {
    get stopping() { return stopping; },
    stop: () => finish(true, false),
    signal: timeout => AbortSignal.any([shutdown.signal, AbortSignal.timeout(timeout)]),
    repeat(callback, milliseconds) {
      // The initial async cycle may settle after Worker exit or SIGTERM.
      // Never resurrect its timer after shutdown has already cleared it.
      if (stopping) return false;
      if (timer) throw new Error("discovery_timer_already_started");
      timer = setInterval(() => { if (!stopping) callback(); }, milliseconds);
      return true;
    },
  };
}
