import assert from "node:assert/strict";
import test from "node:test";
import {
  hasDeliverableEmailDomain,
  isDisposableEmailDomain,
  normalizeEmailAddress,
  validateEmailAddress,
} from "./emailValidation";

function dnsFetcher(responses: Partial<Record<"MX" | "A" | "AAAA", Record<string, unknown>>>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const type = url.searchParams.get("type") as "MX" | "A" | "AAAA";
    return Response.json(responses[type] ?? { Status: 0, Answer: [] });
  }) as typeof fetch;
}

test("normalizes valid email addresses and rejects malformed ones", () => {
  assert.equal(normalizeEmailAddress("  Person+Discord@Example.COM "), "person+discord@example.com");
  assert.equal(normalizeEmailAddress("person..discord@example.com"), null);
  assert.equal(normalizeEmailAddress("person@example"), null);
  assert.equal(normalizeEmailAddress("person@-example.com"), null);
});

test("detects disposable providers and their subdomains", () => {
  assert.equal(isDisposableEmailDomain("mailinator.com"), true);
  assert.equal(isDisposableEmailDomain("inbox.mailinator.com"), true);
  assert.equal(isDisposableEmailDomain("gmail.com"), false);
});

test("accepts a domain with a live MX record", async () => {
  const fetcher = dnsFetcher({ MX: { Status: 0, Answer: [{ type: 15, data: "10 mail.example.com." }] } });
  assert.equal(await hasDeliverableEmailDomain("example.com", fetcher), true);
});

test("rejects a null MX domain", async () => {
  const fetcher = dnsFetcher({ MX: { Status: 0, Answer: [{ type: 15, data: "0 ." }] } });
  assert.equal(await hasDeliverableEmailDomain("example.com", fetcher), false);
});

test("falls back to address records when MX is absent", async () => {
  const fetcher = dnsFetcher({
    MX: { Status: 0, Answer: [] },
    A: { Status: 0, Answer: [{ type: 1, data: "192.0.2.1" }] },
  });
  assert.equal(await hasDeliverableEmailDomain("example.com", fetcher), true);
});

test("blocks disposable email before doing DNS work", async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return Response.json({ Status: 0, Answer: [] });
  }) as typeof fetch;
  assert.deepEqual(await validateEmailAddress("person@mailinator.com", fetcher), { ok: false, reason: "disposable_domain" });
  assert.equal(calls, 0);
});
