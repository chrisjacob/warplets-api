# Compatible dependency security patches

22 October 2026 (Australia/Sydney). Implements the compatible dependency-remediation slice prioritised by [97 — product/design/performance/security review](97-prd-design-performance-security-review.md), after [98 — current/history separation](98-current-inventory-and-retained-directory.md). This improves the shared dependency foundation; it is not scoring qualification or release approval.

## Changes and compatibility

| Package | Before → after | Existing consumer contract |
|---|---|---|
| `follow-redirects` | 1.16.0 → 1.16.1 | Base account → CDP SDK → axios 1.20.0 requests `^1.16.0` |
| `hono` | 4.13.3 → 4.13.13 | Root, bots and Snap stay on major 4; Farcaster and Node-server peers stay compatible |
| `fflate` | 0.7.4 → 0.7.5 | Satori → `@shuding/opentype.js` requests `^0.7.3` |
| `ip-address` | 10.4.0 → 10.7.4 | Cloudflare Puppeteer browser-installer chain → socks requests `^10.1.1` |
| `brace-expansion` | 2.1.6 → 2.1.7 | Pigment/wyw → minimatch requests `^2.0.2`; existing security pin advanced |

Root Hono's minimum is now `^4.13.13`. Narrow vulnerable-range overrides prevent re-resolution to the affected transitive versions, within the inspected parent ranges. Other workspace manifests and all application code remain unchanged. The lockfile changes only these five packages, their registry-resolved integrity values, matching dependency/peer identities and the root minimum. Unrelated resolver updates were discarded, including Node types, Zod and build-tool changes.

The initial broad install encountered the existing `localflare` exotic-subdependency policy error. A scoped update succeeded; the final narrowed lockfile passed scoped frozen installs, including offline installs for the other Hono consumers. `minimumReleaseAge`, `blockExoticSubdeps`, the compromised-package hook, existing patches and audit exceptions remain unchanged. Lifecycle scripts were disabled; no package-manager upgrade or dependency-policy bypass was used.

## Audit result and remaining risk

The fresh production-workspace audit reproduced the previous report: metadata counted **14 moderate / 4 high**, including **two already ignored high installer advisories**. After patching it counts **3 moderate / 2 high**, with both remaining highs still those ignored installer cases. The remaining non-ignored advisory records are three moderates, all on `stream-json@1.9.1`. Both follow-redirects high advisory records and eleven moderate records were removed. Counts refer to audit findings, not demonstrated exploitable paths or independent defects.

`pnpm --dir app audit --prod` still exits nonzero. No finding was newly ignored or relabelled, and this milestone does not claim a clean audit. The two existing `extract-zip` exceptions in `pnpm-workspace.yaml` concern the unused Node browser installer, not the Cloudflare Browser binding. Revisit them before introducing local browser installation or ZIP extraction.

Reachability review:

- The Base Account SDK is dynamically imported by the shared wallet controller when enabled. The redirect implementation is a Node HTTP dependency behind axios; browser builds use axios's browser adapter. The dependency graph alone does not establish browser credential leakage. Patch it nevertheless, and test the installed Node dependency path directly.
- Hono is used by the root API, bots and Snap. Root tests exercise request negotiation and API behavior with the patch. No local use of the specific affected Hono SSG/body/static/JSX helpers was established; this is not proof of whole-app non-reachability.
- Font decompression, CSS brace parsing and the Node browser-installer IP helper have distinct build/server scopes. Their compatible patches do not certify font/input sanitization, SSRF resistance or the complete shared application.
- `stream-json` arrives through `@farcaster/miniapp-node → @farcaster/miniapp-core → @solana/web3.js → jayson`. Jayson 4.3.0 requests `^1.9.1` and eagerly imports CommonJS `stream-json/streamers/StreamValues` and `stream-json/utils/Verifier` in its Node utility module; `parseStream` is used by its TCP/TLS transports. The browser client is separate. Application-source search found no direct Jayson TCP/TLS/parseStream use, but the Farcaster webhook imports miniapp-node: module presence is not proof of safe or exploitable execution. Exact server-bundle reachability remains open.

The published stream-json fixes require 3.5/3.6; forcing v3 under a v1 consumer is not a compatible patch. Next, inspect a maintained parent update or a reviewed backport/removal, verify the server bundle and rerun webhook/Solana parsing tests. Do not grant a broad ignore or declare the older parser harmless merely because one application call path was not found.

## Verification

**259 tests passed:** 223 Discovery/client/wallet/authentication/release/image-route tests, 18 root API tests, fourteen bot tests and four new redirect regressions. `pnpm security:test:redirects` exercises the actual Base account → CDP → axios → follow-redirects resolution, with two loopback-only HTTP servers and synthetic headers:

- Cross-origin object and flat-array headers strip Authorization, Cookie and Proxy-Authorization while retaining an ordinary public header.
- A custom sensitive name containing `$` is treated literally and stripped.
- Same-origin redirects retain required credentials.

An ignored control run against the original 1.16.0 failed both new security cases while the object-form and same-origin controls passed. The patched version passes all four. No real credentials, wallets, providers or external redirect destinations are used.

Root, app, bots and Snap typechecks pass. The app build and unchanged performance budget pass at **232.5 KiB gzip / eleven startup chunks**. The built thesis-only assertion passes; production flags and hidden routes/chunks stay closed. Static preflight and the compromised-package blocklist pass. These checks do not establish production CPU, Core Web Vitals, full server-bundle safety or financial readiness.

The preservation check confirms all original source/cohort/outcome/holder/wallet/cache row hashes remain identical and foreign keys pass. No live store was modified by this work.

Private audit snapshots remain ignored: `.tmp/dependency-remediation-before.json`, SHA-256 `ec364ac7328a408fe2f4635cfad773fed1ddebde31885c404eb5536d30a5519e`; `.tmp/dependency-remediation-after.json`, SHA-256 `a81cb6a6fd432c26fd9eba642859c86a9dfea2306f6ee7678f66b69e2af88a3e`. The vulnerable-version control output is private `.tmp/redirect-security-vulnerable-control.txt`. The audit command is workspace-wide despite its `--dir app` invocation; these numbers must not be presented as Discovery-only exploit counts.

## Next work and unchanged gates

Finish the remaining parser/installer reachability and remediation work before affected releases. Free storage feasibility, compact precomputed reads, active-inventory overflow and the first-result design slice remain priorities. Broad admitted F1 observation and F3/F4 qualification remain required before changing v4.

No scoring or evidence-policy change, new provider requests, quota change, database migration/mutation, raw-evidence movement/deletion, runtime restart, financial action or deploy. Local calibration authority, all Free/evidence/action gates and thesis-only production remain unchanged. Unrelated Network/legal work is excluded from this commit.

References: [follow-redirects array headers](https://github.com/follow-redirects/follow-redirects/security/advisories/GHSA-q3jh-wrc6-jgq8), [sensitive-name escaping](https://github.com/advisories/GHSA-8r9p-f939-6h3c), [Hono static decoding](https://github.com/honojs/hono/security/advisories/GHSA-5r4p-p66f-jhc7), [IP family checks](https://github.com/beaugunderson/ip-address/security/advisories/GHSA-j6r3-76f7-8jcv), [remaining stream-json prototype issue](https://github.com/uhop/stream-json/security/advisories/GHSA-mjw6-4jj6-33hc). Registry manifests, installed parent contracts and private before/after audit snapshots support the exact resolution changes.
