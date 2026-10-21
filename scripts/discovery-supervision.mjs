import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { restartAllowance, watchdogDecision } from "./discovery-watchdog.mjs";

// Bind/close locally rather than inferring vacancy from an HTTP timeout. The
// launcher's own port preflight remains necessary for the subsequent race.
export function discoveryPortAvailable(port = 8794) {
  return new Promise(resolve => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => server.close(error => resolve(!error)));
  });
}

export function discoverySupervisor({ healthy, portAvailable = discoveryPortAvailable, observe, start, terminate, log = () => {},
  now = () => performance.now(), admitStart, wait = (ms, signal) => delay(ms, undefined, { signal }).catch(error => { if (!signal.aborted) throw error; }),
}) {
  const shutdown = new AbortController();
  let owned, running = false, restartTimes = [], cooling = false;
  const reserveStart = admitStart ?? (() => {
    const at = now(), budget = restartAllowance(restartTimes, at); restartTimes = budget.recent;
    if (!budget.allowed) return false;
    restartTimes.push(at); return true;
  });
  const stopped = () => shutdown.signal.aborted;
  function ended() {
    return owned && (owned.ended || owned.child.exitCode != null || owned.child.signalCode != null);
  }
  function terminateOwned() {
    if (!owned || ended() || owned.terminating || !owned.child.pid) return;
    // Retain the exact ChildProcess handle until exit is observed. A successful
    // termination request alone does not authorize dropping ownership or spawn.
    owned.terminating = terminate(owned.child) !== false;
  }
  function stop() {
    if (stopped()) return;
    shutdown.abort();
    terminateOwned();
  }
  async function run() {
    if (running) throw Error("discovery_supervisor_already_running");
    running = true;
    try {
      while (!stopped()) {
        if (ended()) owned = undefined;
        if (!owned && !await healthy(shutdown.signal)) {
          if (stopped()) break;
          if (!await portAvailable()) {
            if (stopped()) break;
            log("Discovery port is unavailable; observing without starting or terminating an unowned process.");
            await observe(shutdown.signal);
            if (!stopped()) await wait(30000, shutdown.signal);
            continue;
          }
          if (stopped()) break;
          let admitted = false, budgetState = "cooldown";
          try { admitted = reserveStart() === true; } catch { budgetState = "unavailable"; }
          if (!admitted) {
            if (cooling !== budgetState) log(budgetState === "unavailable"
              ? "Owned launcher restart ledger unavailable or changed; holding startup without resetting it."
              : "Owned launcher restart budget exhausted; cooling down before another attempt.");
            cooling = budgetState;
            await observe(shutdown.signal);
            if (!stopped()) await wait(30000, shutdown.signal);
            continue;
          }
          cooling = false;
          try {
            const child = start();
            const handle = { child, ended: false, terminating: false }; owned = handle;
            child.once("exit", () => { handle.ended = true; });
            child.once("error", () => { handle.ended = true; log("Owned launcher spawn failed; attempt remains counted."); });
            log(`Started owned discovery launcher PID ${child.pid ?? "unavailable"}`);
          } catch {
            log("Owned launcher spawn failed; attempt remains counted.");
            if (!stopped()) await wait(15000, shutdown.signal);
            continue;
          }
          if (!stopped()) await wait(60000, shutdown.signal);
        }
        if (stopped()) break;
        let healthState = { failures: 0 }, lastCode, lastAction;
        while (!stopped()) {
          await wait(30000, shutdown.signal);
          if (stopped() || ended()) break;
          const report = await observe(shutdown.signal);
          if (stopped()) break;
          healthState = watchdogDecision(healthState, report, Boolean(owned));
          if (report.code !== lastCode || healthState.action !== lastAction) {
            log(`Independent watchdog: ${report.code}; action=${healthState.action}`);
            lastCode = report.code; lastAction = healthState.action;
          }
          if (healthState.action === "restart_owned") {
            log("Independent watchdog requested owned launcher restart after three consecutive failures.");
            terminateOwned(); break;
          }
          if (healthState.action === "report_unowned" && await portAvailable()) {
            if (stopped()) break;
            log("Unowned service failed three checks and its port is now free; returning to bounded startup admission.");
            break;
          }
        }
        if (ended()) owned = undefined;
        if (!stopped()) {
          log("Service observation cycle ended; rechecking after 15s without abandoning an active owned process.");
          await wait(15000, shutdown.signal);
        }
      }
    } finally { stop(); }
  }
  return { run, stop };
}
