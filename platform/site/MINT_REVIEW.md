# Reviewed local mint requests

The member UI sends the published stage's exact `expectedTermsDigest` with an
owner-scoped idempotency key. Before sending, `mint-intent.ts` retains an immutable
copy of that body and the reviewed public stage terms in session storage. It does
not retain eligibility wallet lists or the full collection state.

An unknown response keeps the original request. Reloading or reconnecting the
same wallet exposes **Review original mint request**, including after the stage
closes or new admissions are paused. A different wallet cannot see that request.
Retries use the same inventory, stage, digest and key. Only a response matching
the wallet, mint kind, inventory, stage, terms digest, disclosed price/creation
cost and accepted receipt state clears it. A malformed response or mismatched
binding remains unresolved. Missing storage prevents sending; malformed stored
requests hold and direct the member to existing operation receipts.

New confirmations require complete published terms, available eligibility and
allowance, and an open stage. A known server rejection for closed, sold-out,
ineligible or exhausted stages clears the unaccepted attempt and requires a new
review. Unknown transport and evidence availability failures retain it. The
server remains authoritative for the race between review and admission.

The cost display names mint price and local creation cost separately. Network
and total costs are **Unknown**. This is a local fixture reservation; financial
execution remains disabled.

## Local acceptance

With installed site dependencies, build the site and run:

```
node --test platform/site/tests/*.spec.mjs
node platform/site/tests/mint-lifecycle-qa.mjs
node platform/site/tests/mint-lifecycle-qa.mjs --expiry
node platform/site/tests/mint-lifecycle-qa.mjs --server-reject
node platform/site/tests/mint-lifecycle-qa.mjs --wrong-response
```

The browser scripts use `PLAYWRIGHT_MODULE` and `BROWSER_EXE` from the existing
[local rehearsal instructions](../scripts/HOSTED_REHEARSAL.md). They serve the
compiled React app with production Node HTTP composition, a normalized synthetic
public stage, real guarded admission/storage and genuine Ed25519 wallet
authentication. All requests stay on loopback. Only the clock and deliberately
lost/corrupted responses are test controls; positive API responses are not mocked.

The main case checks 360, 390, 768 and 1440 pixel widths. Focused 390 pixel cases
check local expiry before send, server closure after review, and a wrong returned
terms digest after an actual commit. Worker HTTP parity is recorded separately by
the coordinator's mounted Node/D1 tests. This milestone does not complete B11:
legacy collection adoption and remaining collection authority work stay open.
