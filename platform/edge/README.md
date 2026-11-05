# Local Worker adapter

Use this package to verify D1, R2 and the HTTP contract in a local Workers runtime. Its configuration names an isolated local database and manifest bucket. Run only commands explicitly using local mode. Production resources and deployment workflows are outside this adapter.

The Node reference service remains the full offline rehearsal. The Worker exposes only routes whose storage and authorization behavior has been exercised on this adapter. A local test or preview does not enable financial actions.

Run `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm typecheck` and `pnpm test` in this directory. The workerd integration test uses local D1 and R2 to check single-use challenge consumption across simultaneous requests, session revocation, manifest allowlisting and digest verification. The Worker explicitly rejects non-loopback hostnames.
