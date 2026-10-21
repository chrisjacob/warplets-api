import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { discoveryPortAvailable, discoverySupervisor } from "./discovery-supervision.mjs";

const report = (code = "api_unreachable") => ({ code, restart_recommended: !["healthy", "degraded"].includes(code) });
function launcher(pid) { return Object.assign(new EventEmitter(), { pid, exitCode: null, signalCode: null }); }
function rig(options = {}) {
  let time = 0, nextPid = 1000;
  const starts = [], kills = [], logs = [];
  const context = { get time() { return time; }, starts, kills, logs, supervisor: undefined };
  context.supervisor = discoverySupervisor({
    now: () => time, healthy: async () => false, portAvailable: async () => true, observe: async () => report(), log: text => logs.push(text),
    start() { const child = launcher(++nextPid); starts.push({ at: time, child }); return child; },
    terminate(child) { kills.push(child.pid); child.signalCode = "SIGTERM"; child.emit("exit", null, "SIGTERM"); return true; },
    wait: async (ms, signal) => { if (signal.aborted) return; time += ms; await options.step?.(ms, context); },
    ...options.dependencies,
  });
  return context;
}

test("real loopback vacancy probe distinguishes an occupied port from a closed one", { timeout: 5000 }, async t => {
  const server = createServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close()); const port = server.address().port;
  assert.equal(await discoveryPortAvailable(port), false);
  await new Promise(resolve => server.close(resolve));
  assert.equal(await discoveryPortAvailable(port), true);
});

test("a previously healthy unowned server can disappear and return to bounded startup after three failures", { timeout: 5000 }, async t => {
  const external = createServer(); await new Promise(resolve => external.listen(0, "127.0.0.1", resolve));
  t.after(() => external.close()); const port = external.address().port;
  let initial = true, observations = 0;
  const r = rig({ dependencies: {
    healthy: async () => { const value = initial; initial = false; return value; },
    portAvailable: () => discoveryPortAvailable(port),
    observe: async () => { observations++; return report(); },
  }, step: async (_ms, state) => {
    if (state.time >= 150000 && external.listening) await new Promise(resolve => external.close(resolve));
    if (state.starts.length) state.supervisor.stop();
  } });
  await r.supervisor.run();
  assert.equal(observations, 5); assert.equal(r.starts.length, 1);
  assert.equal(r.starts[0].at, 165000); // Wait for vacancy after 5 failures, then 15s recheck.
  assert.deepEqual(r.kills, [r.starts[0].child.pid]); // Stop owns only its new launcher.
});

test("an unhealthy occupied unowned port never consumes a launch attempt or receives termination", async () => {
  const r = rig({ dependencies: { portAvailable: async () => false }, step: (_ms, state) => {
    if (state.time >= 180000) state.supervisor.stop();
  } });
  await r.supervisor.run(); assert.equal(r.starts.length, 0); assert.equal(r.kills.length, 0);
});

test("owned runtime failure needs three consecutive checks and keeps the same process until its exit", async () => {
  let observations = 0;
  const r = rig({ dependencies: { observe: async () => { observations++; return report(observations === 3 ? "degraded" : "api_unreachable"); } }, step: (_ms, state) => {
    if (state.starts.length === 2) state.supervisor.stop();
  } });
  await r.supervisor.run();
  assert.equal(observations, 6); assert.equal(r.starts.length, 2);
  assert.equal(r.starts[1].at, 255000); // Source degradation resets the first 2 runtime failures.
  assert.deepEqual(r.kills, r.starts.map(row => row.child.pid));
});

test("failed termination never abandons a living owned handle or starts a second launcher", async () => {
  let attempts = 0;
  const r = rig({ dependencies: { terminate() { attempts++; return false; } }, step: (_ms, state) => {
    if (state.time >= 400000) state.supervisor.stop();
  } });
  await r.supervisor.run(); assert.equal(r.starts.length, 1); assert.ok(attempts >= 2);
});

test("signal exits, asynchronous spawn errors and synchronous spawn failures all retain start accounting", async () => {
  for (const mode of ["signal", "async_error", "throw"]) {
    let attempts = 0, time = 0;
    const starts = [];
    const supervisor = discoverySupervisor({ healthy: async () => false, portAvailable: async () => true, observe: async () => report(), now: () => time,
      start() {
        attempts++; starts.push(time);
        if (mode === "throw") { if (attempts === 4) queueMicrotask(() => supervisor.stop()); throw Error("spawn failed"); }
        const child = launcher(mode === "async_error" ? undefined : attempts);
        queueMicrotask(() => {
          if (mode === "async_error") child.emit("error", new Error("spawn failed"));
          else { child.signalCode = "SIGTERM"; child.emit("exit", null, "SIGTERM"); }
          if (attempts === 4) supervisor.stop();
        });
        return child;
      },
      terminate() { assert.fail("cannot terminate an exited or never-spawned process"); },
      wait: async ms => { time += ms; assert.ok(time < 2_000_000); },
    });
    await supervisor.run();
    assert.equal(attempts, 4); assert.ok(starts[3] - starts[0] >= 900000);
    for (const at of starts) assert.ok(starts.filter(value => value <= at && at - value < 900000).length <= 3);
  }
});

test("48 simulated hours of source degradation, pause and quota holds do not restart a recent timer", async () => {
  let checks = 0;
  const r = rig({ dependencies: { healthy: async () => true, observe: async () => { checks++; return report(checks % 2 ? "degraded" : "healthy"); } },
    step: (_ms, state) => { if (state.time >= 48 * 3600000) state.supervisor.stop(); },
  });
  await r.supervisor.run(); assert.ok(checks > 5000); assert.equal(r.starts.length, 0); assert.equal(r.kills.length, 0);
});

test("a stop during health or port checks cannot admit a late launcher", async () => {
  for (const phase of ["health", "port"]) {
    let supervisor, starts = 0;
    supervisor = discoverySupervisor({ healthy: async () => { if (phase === "health") supervisor.stop(); return false; },
      portAvailable: async () => { supervisor.stop(); return true; }, observe: async () => report(),
      start() { starts++; return launcher(1); }, terminate() { assert.fail("nothing owned"); },
    });
    await supervisor.run(); assert.equal(starts, 0);
  }
});

test("shutdown cancels a real startup wait and the owned subprocess exits naturally", { timeout: 10000 }, async t => {
  const source = `
    import { spawn } from 'node:child_process';
    import { once } from 'node:events';
    import { discoverySupervisor } from ${JSON.stringify(new URL("./discovery-supervision.mjs", import.meta.url).href)};
    let closed;
    const supervisor = discoverySupervisor({ healthy: async () => false, portAvailable: async () => true,
      observe() { throw Error('no polling before boot grace'); },
      start() {
        const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'ignore',windowsHide:true});
        closed = once(child,'close'); process.send('owned_started'); return child;
      }, terminate: child => child.kill(),
    });
    process.once('message', () => supervisor.stop());
    await supervisor.run(); await closed; process.disconnect();
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], { stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true });
  t.after(() => child.kill()); let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  const closed = once(child, "close");
  assert.deepEqual(await once(child, "message"), ["owned_started", undefined]);
  child.send("stop");
  assert.deepEqual(await closed, [0, null], stderr);
});
