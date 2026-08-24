import assert from "node:assert/strict";
import test from "node:test";
import { localCommandReply } from "./localCommands.js";

test("help is available without calling the 10X API", async () => {
  const reply = localCommandReply("help");

  assert.ok(reply);
  assert.match(reply, /^10X Warplets commands/);
  assert.match(reply, /\/search <terms>/);
  assert.equal(localCommandReply("search"), null);
});
