import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import { restartAllowance } from "./discovery-watchdog.mjs";

const VERSION = "discovery-restart-budget-v1";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const encode = attempts => JSON.stringify({ version: VERSION, revision: randomUUID(), attempts }) + "\n";

// Only elapsed time witnessed by this owner can retire a reservation. Persisted
// attempts restart their full cooldown when a new owner loads them; no wall-clock
// date (or long downtime claimed by one) can refund an attempt.
export function durableRestartBudget(file, { now = () => performance.now(), io = fs } = {}) {
  let expected, times, previous;
  function read() {
    let info;
    try { info = io.lstatSync(file); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
    if (!info.isFile() || info.isSymbolicLink()) throw Error("restart_budget_invalid");
    const fd = io.openSync(file, "r");
    try {
      const bytes = Buffer.alloc(1025), size = io.readSync(fd, bytes, 0, bytes.length, 0);
      if (size > 1024) throw Error("restart_budget_invalid");
      const raw = bytes.subarray(0, size).toString("utf8"), value = JSON.parse(raw);
      if (!value || Object.keys(value).sort().join() !== "attempts,revision,version" || value.version !== VERSION ||
          typeof value.revision !== "string" || !uuid.test(value.revision) || !Number.isInteger(value.attempts) || value.attempts < 0 || value.attempts > 3) {
        throw Error("restart_budget_invalid");
      }
      return { raw, attempts: value.attempts };
    } finally { io.closeSync(fd); }
  }
  function replace(raw) {
    const pending = `${file}.${randomUUID()}.pending`;
    let fd, created = false;
    try {
      fd = io.openSync(pending, "wx", 0o600); created = true;
      io.writeFileSync(fd, raw); io.fsyncSync(fd); io.closeSync(fd); fd = undefined;
      io.renameSync(pending, file);
    } finally {
      if (fd !== undefined) io.closeSync(fd);
      // Only our own temporary file. A crash can leave it for review; it is
      // never adopted as a committed budget or used to reset the ledger.
      if (created && io.existsSync(pending)) io.unlinkSync(pending);
    }
  }
  return {
    admit() {
      // The ordinary supervisor lock is still required. This additional guard
      // serializes ledger operations and refuses abandoned/concurrent writers.
      // No automatic stale-lock deletion or unsafe counter reconstruction.
      const guard = `${file}.lock`, lock = io.openSync(guard, "wx", 0o600);
      try {
        const at = now();
        if (!Number.isFinite(at) || at < 0 || previous !== undefined && at < previous) throw Error("restart_budget_clock_invalid");
        previous = at;
        const saved = read();
        if (times === undefined) {
          if (saved === null) {
            // First adoption cannot know the legacy process's recent attempts.
            // Reserve all three slots before witnessing one full safe interval.
            const raw = encode(3); replace(raw); expected = raw; times = [at, at, at];
          } else { expected = saved.raw; times = Array(saved.attempts).fill(at); }
        } else if (saved?.raw !== expected) throw Error("restart_budget_changed");
        const budget = restartAllowance(times, at);
        if (!budget.allowed) return false;
        const recent = [...budget.recent, at], raw = encode(recent.length);
        replace(raw); // Commit BEFORE spawn, including synchronous spawn failures.
        expected = raw; times = recent;
        return true;
      } finally { io.closeSync(lock); io.unlinkSync(guard); }
    },
  };
}
