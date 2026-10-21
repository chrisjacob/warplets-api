# Remove the legacy stream parser dependency

22 October 2026 (Australia/Sydney). Implements the remaining parser-remediation slice from [99](99-compatible-dependency-security-patches.md), the [readiness review](97-prd-design-performance-security-review.md) and PRD §17.7. This advances a concrete shared release prerequisite. It changes no Discovery score, source collection, evidence gate or financial capability.

## Change and compatibility boundary

The active workspace lockfile previously resolved `@farcaster/miniapp-node → @farcaster/miniapp-core → @solana/web3.js@1.98.4 → jayson@4.3.0 → stream-json@1.9.1`. Three moderate audit records remained on that parser. The installed Mini App Node SDK is also the latest published version (0.2.0), so a normal SDK patch does not remove this path.

The root override now pins **only `@solana/web3.js@1.98.4>jayson` to 5.0.0**. This is an explicitly reviewed major-version override outside the parent's original `^4.1.1` range, not a routine compatible patch. A future Solana parent version requires its own review; the override is intentionally version-scoped. No application imports or webhook implementation change.

Jayson 5 removes `stream-json`, uses platform Web Crypto for browser-client request IDs and requires Node ≥20. Local Node 22 and the repository's Node 24 CI meet that floor. The actual Solana client imports `jayson/lib/client/browser`; its reviewed request/response implementation preserves the relevant callback, batch, explicit-ID, notification and JSON parsing contracts. ID generation changes from UUID dependency calls to secure platform randomness, with a `getRandomValues` fallback and a failure when secure randomness is unavailable. All product browser contexts must remain secure contexts.

The package archive was inspected without running its scripts and matched the registry's SHA-512 integrity:

`sha512-FghxOWlJB5ZPsRsuMF1U4GFHjkJfOEYSlIHpI6Wt6MXIzvqWVo0Kpl7/SMfY36vWggA+b+L09zRGP6m4ROVnKg==`

The lockfile removes the now-unreferenced `stream-json`, `stream-chain`, `eyes` and UUID 11 entries and the obsolete Jayson UUID override. Only the new Jayson resolution/engine, its parent link and these removals remain: **six insertions / 33 deletions**. Resolver-proposed Node types, Zod, build-tool and other updates were discarded. A filtered **frozen offline install** verifies the narrowed graph. Existing minimum release age, exotic-subdependency protection, compromised-package hook, audit exceptions and disabled install scripts are preserved. The root workspace lockfile controls supported installs/CI; legacy nested lockfiles are untouched.

Jayson TCP/TLS/server transports are not certified by this change. Application source has no direct Jayson streaming/TCP/TLS use; the override is supported for the inspected Solana browser-client consumption path. Any future transport use needs separate review.

## Actual server bundle and audit evidence

Wrangler's local Pages Functions build and esbuild metafile identify which dependency files contribute bytes to the server output. Before this change the bundle already contained only Jayson's browser client/request generator, with **no `stream-json` or `stream-chain` contribution**. The new build also excludes those parsers and uses the reviewed Jayson 5 browser client/ID generator. This closes the previously unknown server-bundle inclusion question for the measured artifacts; it does not establish an exploitable pre-change webhook path.

The initial baseline build omitted explicit compatibility flags and emitted the existing Node-buffer warning. The final build explicitly uses the existing app settings, `2026-08-27` and `nodejs_compat`, and succeeds. These are dependency-inclusion checks, not comparable size/performance measurements or whole-application exploitability certification. Builds include the current worktree's unrelated Network/legal changes; they are not a clean-commit deployment artifact, and those sources are excluded from this commit.

The fresh `pnpm --dir app audit --prod --json` reports **zero moderate records**, versus three in 99. The actions contain only the two previously excepted `extract-zip` high records from the unused browser installer. Metadata still reports **two highs**, and the command exits **1**. No new exception is added, and no clean-audit or release claim is made. Revisit the existing exceptions before introducing local browser installation/ZIP extraction; retain artifact-specific review of other surfaces.

Private ignored evidence:

| Artifact | SHA-256 |
|---|---|
| `.tmp/parser-remediation-audit-20261022-001.json` | `ecb106e4dd348fc8a9a7ce859840ca5a75c0dabf14d7e8db3052e046bf617036` |
| `.tmp/parser-remediation-proof-20261022-001.json` (audit, lock and both server graphs/bundles) | `d22591a6ebbe44133418b15119af8e6e9971c5c5da7f12a31ed3ed8e70aa2414` |
| `.tmp/jayson-worker-proof-20261022-001.json` | `877ccbe66e9a7ae2092721832ef85210fcf2de3ce80c7a8ff486a89ae4991a50` |

## Verification

**76 focused tests pass:**

- Six actual installed-path Solana/Jayson tests: finalized HTTP request/result handling, secure unique IDs, missing accounts, malformed results/JSON/RPC errors, batch/callback/notification behavior, `__proto__` preserved as JSON data, and secure-generator fallback/failure. Mocked `rpc.invalid` fetches never contact a provider.
- Ten real-SDK signed webhook cases: four current events, two supported legacy aliases, forged signatures rejected before Hub lookup, absent/error Hub results, and signed malformed events. Hub responses, API credentials, notification tokens and D1 are synthetic; no verification implementation is mocked or relaxed.
- Two existing Resend webhook signature tests, 54 shared middleware/security/session/wallet regressions, and four existing actual-dependency redirect-security tests.

Both new regression commands are added to the existing security CI workflow; hosted CI execution is not claimed. Root/app typechecks, Vite production build and Pages Functions build pass. The static shell is **227.8 KiB gzip across eleven chunks**, passing the unchanged budget. The fresh thesis-only build/server-flag assertion, static security preflight and compromised-package blocklist pass. Bundle values reflect the current worktree and are not a causal performance comparison.

An additional isolated workerd smoke test uses the actual installed Jayson browser client with the existing app compatibility settings. Three mocked RPC replies match, request IDs are secure/unique, outbound IO is blocked and remains zero, and no database/app/provider credentials are attached. The runtime is disposed afterward. This tests the changed platform-ID behavior, not production throughput or every browser/device.

Read-only preservation verifies all **1,732 original evidence row hashes** and foreign keys. Actual GMGN-key scans cover task sources, both private Pages bundles/metafiles, audit/proof outputs and all 66 fresh frontend JS/CSS assets; secret files remain ignored/untracked. No credentials are retained in reports.

## Next work and unchanged gates

The three documented parser-moderate records are removed; the two existing installer exceptions and broader CSP/access/abuse controls remain distinct work. Capacity/storage and affordable serving still block Discovery readiness. Continue ordinary admitted unfamiliar-token coverage and qualify organic volume/meaningful holder growth; those are the main product-value dependencies. Additional profiling should address a specific cost hypothesis that changes the Free-capacity decision, rather than become the default milestone. The test-only phase plan in 111 remains available when needed; no speedup or ranking improvement is claimed here.

Score-v4, serving-v4, all original hashes/schema/time/source/generation checks, provider Free limits, local calibration authority, action/election/financial gates and thesis-only exposure remain unchanged. No new service, source request, research-counter reset, live migration/rebuild, preview/collector restart, evidence eviction, signing authority or deploy.

Primary references: [Jayson upstream package and Node floor](https://github.com/tedeh/jayson/blob/master/package.json), [browser client](https://github.com/tedeh/jayson/blob/master/lib/client/browser/index.js), [secure ID generator](https://github.com/tedeh/jayson/blob/master/lib/generateId.js), [stream-json prototype advisory](https://github.com/uhop/stream-json/security/advisories/GHSA-mjw6-4jj6-33hc), [filter-complexity advisory](https://github.com/advisories/GHSA-528h-pc64-c93x), [JSONC advisory](https://github.com/advisories/GHSA-hqr4-qq8f-hg3x). Exact reviewed package bytes are pinned above; live upstream links may evolve.
