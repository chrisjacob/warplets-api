import assert from "node:assert/strict";
import test from "node:test";
import { createApp, prefersSnapRepresentation } from "./app.js";
import { decodeCursor, parseTokenIds, paymentRequirements } from "./agent-api.js";

test("weighted Accept negotiation chooses HTML for browsers", () => {
  assert.equal(prefersSnapRepresentation("text/html,application/xhtml+xml,*/*;q=0.8"), false);
  assert.equal(prefersSnapRepresentation("*/*"), false);
  assert.equal(
    prefersSnapRepresentation("text/html;q=0.5, application/vnd.farcaster.snap+json;q=0.9"),
    true,
  );
});

test("browser root is the temporary API landing page", async () => {
  const response = await createApp({ skipJFSVerification: true }).request("https://api.10x.meme/", {
    headers: { accept: "text/html" },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  assert.match(await response.text(), /private-drop period has ended/i);
  assert.equal(response.headers.get("vary"), "Accept");
});

test("API token ID lists are bounded and deduplicated", () => {
  assert.deepEqual(parseTokenIds("[5,2,5,-1,0,10000,10001,3.2,\"4\"]"), [2, 5, 10000]);
  assert.deepEqual(parseTokenIds("not-json"), []);
});

test("opaque cursor parsing rejects malformed values", () => {
  assert.equal(decodeCursor(btoa("4512")), 4512);
  assert.equal(decodeCursor("%%%"), null);
  assert.equal(decodeCursor(btoa("-1")), null);
});

test("x402 defaults to Base Sepolia and one USDC cent", () => {
  const requirements = paymentRequirements({} as never);
  assert.equal(requirements.network, "eip155:84532");
  assert.equal(requirements.amount, "10000");
  assert.equal(requirements.asset, "0x036CbD53842c5426634e7929541eC2318f3dCF7e");
});
