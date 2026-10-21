import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { durableRestartBudget } from "./discovery-restart-budget.mjs";

const root = fileURLToPath(new URL("../.tmp/", import.meta.url));
const moduleUrl = new URL("./discovery-restart-budget.mjs", import.meta.url).href;
function fixture(t) {
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, "restart-budget-test-"));
  t.after(() => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(root));
    assert.ok(path.basename(resolved).startsWith("restart-budget-test-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return path.join(directory, "budget.json");
}
function initialized(t) {
  const file = fixture(t); let at = 0;
  const budget = durableRestartBudget(file, { now: () => at });
  assert.equal(budget.admit(), false);
  at = 900000; assert.equal(budget.admit(), true);
  return { file, budget, set: value => { at = value; } };
}
const count = file => JSON.parse(fs.readFileSync(file, "utf8")).attempts;

test("first adoption holds unknown legacy attempts for a witnessed 15 minutes, including the boundary", t => {
  const file = fixture(t); let time = 100;
  const budget = durableRestartBudget(file, { now: () => time });
  assert.equal(budget.admit(), false); assert.equal(count(file), 3);
  time = 900099; assert.equal(budget.admit(), false);
  time++; assert.equal(budget.admit(), true);
  assert.equal(budget.admit(), true); assert.equal(budget.admit(), true);
  assert.equal(budget.admit(), false); assert.equal(count(file), 3);
});

test("each persisted attempt receives a fresh full cooldown on ownership change, regardless of wall time", t => {
  const { file } = initialized(t);
  let time = 10;
  const second = durableRestartBudget(file, { now: () => time });
  assert.equal(second.admit(), true); assert.equal(second.admit(), true); assert.equal(second.admit(), false);
  // Date.now is never consulted. A late owner still witnesses the full wait.
  time = 1e12;
  const third = durableRestartBudget(file, { now: () => time });
  assert.equal(third.admit(), false);
  time += 899999; assert.equal(third.admit(), false);
  time++; assert.equal(third.admit(), true);
});

test("continuing owner releases individual rolling reservations instead of granting three per fixed interval", t => {
  const { budget, set, file } = initialized(t);
  set(1000000); assert.equal(budget.admit(), true);
  set(1100000); assert.equal(budget.admit(), true);
  set(1799999); assert.equal(budget.admit(), false);
  set(1800000); assert.equal(budget.admit(), true); assert.equal(count(file), 3);
  assert.equal(budget.admit(), false);
  set(1900000); assert.equal(budget.admit(), true);
});

test("nonfinite and backward monotonic readings cannot retire or refund attempts", t => {
  const { budget, set, file } = initialized(t), before = fs.readFileSync(file, "utf8");
  for (const value of [-1, 899999, NaN, Infinity]) { set(value); assert.throws(() => budget.admit()); }
  assert.equal(fs.readFileSync(file, "utf8"), before);
  set(900000); assert.equal(budget.admit(), true); assert.equal(budget.admit(), true); assert.equal(budget.admit(), false);
});

test("new OS processes retain committed attempts, including an abrupt exit immediately after reservation", t => {
  const { file } = initialized(t);
  const child = source => spawnSync(process.execPath, ["--input-type=module", "-e",
    `import { durableRestartBudget } from ${JSON.stringify(moduleUrl)};
     const budget = durableRestartBudget(${JSON.stringify(file)}, {now:()=>0}); ${source}`],
    { encoding: "utf8", windowsHide: true, timeout: 10000 });
  const first = child("if (!budget.admit()) process.exit(99); process.exit(17);");
  assert.equal(first.status, 17, first.stderr); assert.equal(count(file), 2);
  const second = child("if (!budget.admit() || budget.admit()) process.exit(99);");
  assert.equal(second.status, 0, second.stderr); assert.equal(count(file), 3);
  const third = child("if (budget.admit()) process.exit(99);");
  assert.equal(third.status, 0, third.stderr); assert.equal(count(file), 3);
});

test("invalid, oversized, linked and unreadable ledgers remain untouched and block startup", t => {
  const file = fixture(t);
  for (const raw of ["{", "null", "{}", " ".repeat(1025),
    JSON.stringify({ version: "discovery-restart-budget-v1", revision: "bad", attempts: 0 }),
    JSON.stringify({ version: "discovery-restart-budget-v1", revision: "01234567-0123-4123-8123-012345678901", attempts: 4 }),
    JSON.stringify({ version: "discovery-restart-budget-v1", revision: "01234567-0123-4123-8123-012345678901", attempts: 0, extra: true })]) {
    fs.writeFileSync(file, raw);
    assert.throws(() => durableRestartBudget(file).admit());
    assert.equal(fs.readFileSync(file, "utf8"), raw);
  }
  const before = fs.readFileSync(file, "utf8");
  for (const io of [
    { ...fs, lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => true }) },
    { ...fs, readSync: () => { throw Error("unreadable"); } },
  ]) assert.throws(() => durableRestartBudget(file, { io }).admit());
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("failed write, sync or atomic replacement cannot grant a start or discard the previous debt", t => {
  const { file } = initialized(t), before = fs.readFileSync(file, "utf8");
  for (const operation of ["writeFileSync", "fsyncSync", "renameSync"]) {
    const budget = durableRestartBudget(file, { now: () => 0, io: { ...fs, [operation]: () => { throw Error("disk failure"); } } });
    assert.throws(() => budget.admit());
    assert.equal(fs.readFileSync(file, "utf8"), before);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["budget.json"]);
  }
  const budget = durableRestartBudget(file, { now: () => 0 });
  assert.equal(budget.admit(), true); assert.equal(count(file), 2);
});

test("concurrent or abandoned guards are held without auto-deletion or ledger replacement", t => {
  const { file } = initialized(t), before = fs.readFileSync(file, "utf8"), lock = file + ".lock";
  fs.writeFileSync(lock, "retained-owner");
  assert.throws(() => durableRestartBudget(file).admit());
  assert.equal(fs.readFileSync(lock, "utf8"), "retained-owner");
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("a second writer and a removed/replaced ledger cannot reuse stale in-memory reservations", t => {
  const { file, budget } = initialized(t);
  const other = durableRestartBudget(file, { now: () => 0 });
  assert.equal(other.admit(), true);
  assert.throws(() => budget.admit(), /changed/); assert.equal(count(file), 2);
  const replacement = fs.readFileSync(file, "utf8"); fs.unlinkSync(file);
  assert.throws(() => other.admit(), /changed/); assert.equal(fs.existsSync(file), false);
  fs.writeFileSync(file, replacement); assert.equal(other.admit(), true); assert.equal(count(file), 3);
});

test("a crash inside atomic replacement retains the old debt and an explicit orphan-guard hold", t => {
  const { file } = initialized(t), before = fs.readFileSync(file, "utf8");
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import * as fs from 'node:fs'; import { durableRestartBudget } from ${JSON.stringify(moduleUrl)};
    durableRestartBudget(${JSON.stringify(file)}, { now:()=>0, io:{...fs,renameSync:()=>process.exit(19)} }).admit();
  `], { encoding: "utf8", windowsHide: true, timeout: 10000 });
  assert.equal(child.status, 19, child.stderr); assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.equal(fs.existsSync(file + ".lock"), true);
  assert.throws(() => durableRestartBudget(file).admit());
  assert.equal(fs.readdirSync(path.dirname(file)).filter(name => name.endsWith(".pending")).length, 1);
});

test("a crash after replacement keeps the new reservation even though no launcher could start", t => {
  const { file } = initialized(t);
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import * as fs from 'node:fs'; import { durableRestartBudget } from ${JSON.stringify(moduleUrl)};
    durableRestartBudget(${JSON.stringify(file)}, { now:()=>0, io:{...fs,renameSync:(...args)=>{fs.renameSync(...args);process.exit(23);}} }).admit();
  `], { encoding: "utf8", windowsHide: true, timeout: 10000 });
  assert.equal(child.status, 23, child.stderr); assert.equal(count(file), 2);
  assert.equal(fs.existsSync(file + ".lock"), true);
  assert.throws(() => durableRestartBudget(file).admit());
  assert.equal(fs.readdirSync(path.dirname(file)).filter(name => name.endsWith(".pending")).length, 0);
});
