import test from "node:test";
import assert from "node:assert/strict";
import { latestRequest } from "./latestRequest";
test("a late response cannot overwrite a newer vote or account; cancelled private data never reaches the UI", async () => {
  const request = latestRequest(),
    seen: string[] = [];
  let release!: (v: string) => void;
  let signal!: AbortSignal;
  const first = request.run(
    (s) => {
      signal = s;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    },
    (v) => seen.push(v),
    () => assert.fail(),
  );
  await request.run(
    async () => "new account",
    (v) => seen.push(v),
    () => assert.fail(),
  );
  assert.equal(signal.aborted, true);
  release("old private rewards");
  await first;
  assert.deepEqual(seen, ["new account"]);
  const stale = request.run(
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
    (v) => seen.push(v),
    () => assert.fail(),
  );
  request.cancel();
  release("signed-out rewards");
  await stale;
  assert.deepEqual(seen, ["new account"]);
});
