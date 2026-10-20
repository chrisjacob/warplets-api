import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { discoveryLifecycle } from "./discovery-lifecycle.mjs";

function setup(relay) {
  const child = new EventEmitter();
  let terminated = 0, failures = 0;
  const lifecycle = discoveryLifecycle({ child, relay,
    terminateChild: () => { terminated++; }, onWorkerFailure: () => { failures++; },
  });
  return { child, lifecycle, counts: () => ({ terminated, failures }) };
}

for (const phase of ["headers", "body"]) test(`Worker exit interrupts loopback ${phase} and cannot install a late timer`, { timeout: 5000 }, async t => {
  const received = Promise.withResolvers();
  const server = createServer((_request, response) => {
    if (phase === "body") {
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"state":');
    }
    received.resolve(); // Deliberately never finishes headers/body.
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const { child, lifecycle, counts } = setup();
  t.after(() => lifecycle.stop());
  const request = fetch(`http://127.0.0.1:${server.address().port}/`, { signal: lifecycle.signal(300_000) }).then(response => response.json());
  const rejected = assert.rejects(request, { name: "AbortError" });
  await received.promise;
  child.emit("exit", 1, null);
  await rejected;
  assert.equal(lifecycle.repeat(() => assert.fail("late collection tick"), 1), false);
  assert.equal(lifecycle.signal(300_000).aborted, true);
  assert.deepEqual(counts(), { terminated: 0, failures: 1 });
});

test("intentional stop cancels scheduled work and terminates its child only once", t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let ticks = 0, closed = 0, connections = 0;
  const { child, lifecycle, counts } = setup({ close() { closed++; }, closeAllConnections() { connections++; } });
  assert.equal(lifecycle.repeat(() => { ticks++; }, 60_000), true);
  assert.throws(() => lifecycle.repeat(() => {}, 60_000), /already_started/);
  t.mock.timers.tick(60_000);
  assert.equal(ticks, 1);
  assert.equal(lifecycle.stop(), true);
  assert.equal(lifecycle.stop(), false);
  child.emit("exit", 0, null);
  t.mock.timers.tick(600_000);
  assert.equal(ticks, 1);
  assert.equal(lifecycle.repeat(() => { ticks++; }, 1), false);
  assert.deepEqual({ closed, connections, ...counts() }, { closed: 1, connections: 1, terminated: 1, failures: 0 });
});

test("spawn errors and unexpected clean exits both release startup resources once", () => {
  for (const event of ["error", "exit"]) {
    const { child, lifecycle, counts } = setup();
    const signal = lifecycle.signal(2000);
    child.emit(event, event === "error" ? new Error("spawn failed") : 0);
    child.emit("exit", 0, null);
    assert.equal(signal.aborted, true);
    assert.equal(lifecycle.stopping, true);
    assert.equal(lifecycle.stop(), false);
    assert.deepEqual(counts(), { terminated: 0, failures: 1 });
  }
});

test("individual request timeout leaves later cycles available", { timeout: 5000 }, async () => {
  const { lifecycle, counts } = setup();
  try {
    const signal = lifecycle.signal(1);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(signal.aborted, true);
    assert.equal(lifecycle.signal(300_000).aborted, false);
    assert.equal(lifecycle.stopping, false);
    assert.deepEqual(counts(), { terminated: 0, failures: 0 });
  } finally { lifecycle.stop(); }
});

test("launcher process exits naturally after losing its Worker during the initial cycle", { timeout: 10_000 }, async t => {
  // A real process/HTTP relay catches leaked timers or listener handles that
  // a mocked callback test cannot. No Wrangler, database or provider is used.
  const source = `
    import { EventEmitter } from 'node:events';
    import { createServer } from 'node:http';
    import { discoveryLifecycle } from ${JSON.stringify(new URL("./discovery-lifecycle.mjs", import.meta.url).href)};
    const relay = createServer();
    await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve));
    const worker = new EventEmitter();
    const lifecycle = discoveryLifecycle({ child: worker, relay,
      terminateChild() { throw new Error('cannot kill an exited Worker'); },
      onWorkerFailure() { process.exitCode = 1; },
    });
    process.once('message', () => { worker.emit('exit', 1, null); process.disconnect(); });
    const pending = new Promise(resolve => lifecycle.signal(300000).addEventListener('abort', resolve, { once: true }));
    process.send('cycle_started');
    await pending;
    if (lifecycle.repeat(() => { throw new Error('resurrected timer'); }, 60000)) throw new Error('late timer admitted');
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], { stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true });
  t.after(() => child.kill());
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  const ended = once(child, "close");
  assert.deepEqual(await once(child, "message"), ["cycle_started", undefined]);
  child.send("worker_exit");
  assert.deepEqual(await ended, [1, null], stderr);
});
