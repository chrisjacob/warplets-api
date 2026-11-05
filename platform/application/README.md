# Application extraction checkpoint

The Node Earn submission, leaderboard, member submission and claim-read HTTP paths now exercise `earn/service.mjs` and a named Promise-returning repository. Wallet ownership comes from the authenticated transport principal. Existing CLI exports stay synchronous. The Node repository completes its SQLite transaction before resolving; there is no async transaction callback.

`ports.ts` describes the implemented narrow boundary. The context is copied/frozen, with financial execution disabled. Evidence, artifact and job ports are explicitly unavailable at this checkpoint; B02 must supply them before ingestion or jobs. Existing admission keeps its durable wallet/request-key receipt and accepts no expected revisions. Full revision/fence receipts, final review services, read/compute/commit settlement, and shared Worker HTTP remain unfinished B01/B02/B06/B07 work. This checkpoint is not a D1 adapter.

The pre-extraction `fixtures/earn-golden.json` pins board, allocation, proofs, audit chain and configuration hashes. `fixtures/earn-scenario.mjs` reproduces the sanitized scenario through the Node service. Node and WebCrypto adapters share historical canonical bytes and the existing strict Ed25519 key/signature encodings. Semantic archive commitments remain distinct from exact-byte object digests.

The Node persistence module no longer imports synthetic price seeds. Compatibility tests and demos receive those only through `earn/fixtures.mjs`. A browser bundle test checks the portable service/context/WebCrypto import graph; it does not claim deployed Worker or D1 behavior.

Checks: `node --test platform/application/contract.test.mjs platform/security/canonical.test.mjs`, existing domain/Earn/contract tests, and `node platform/contracts/generate.mjs --check`. The portable bundle check lives in `platform/edge/test/portable-service.test.mjs`, after edge dependencies install; the reference suite remains dependency-free. Edge TypeScript configuration includes `application/ports.ts`. No public API shape, database migration or production capability changed.
