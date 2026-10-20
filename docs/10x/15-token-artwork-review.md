# Token artwork — local review

20 October 2026, Australia/Sydney. Local development only; no deployment, paid service, signing or policy changes.

## Result

Discover cards now give token artwork 88px (76px on narrow screens), with a 144px image on token pages (104px on narrow screens). Images preserve their full composition, reserve their layout space, and use lazy loading on lists. Click the artwork to inspect the mint. An unavailable image is explicitly labelled and never replaced with invented art.

DEX Screener returns no `info.imageUrl` for several leading contenders, including the saved DHPx…pump example. The existing market-image component consequently showed initials. The fallback replays each mint's retained Pump creation instruction, reads its metadata URI, fetches the linked JSON through an allowlisted IPFS gateway and caches its image URL separately from candidate evidence. The first six leading contenders gained image URLs during verification; the timer continues filling remaining gaps.

Provider images take precedence. If they fail, the component tries the cached creation-linked artwork. `ipfs://` references are supported and normalized to the Pinata gateway; `ipfs.io` was returning a browser challenge on this workstation. Twitter-hosted `/media/` artwork is accepted because actual creation-linked metadata uses it. Arbitrary hosts, executable/data URLs, credentials and custom ports remain disallowed. This is presentation metadata, not proof of brand authenticity, uniqueness or token safety.

## Collection and limits

- New additive local migration `0012_token_artwork.sql`; no existing candidate, market, cohort or election payload is rewritten.
- Authenticated `/api/10x/admin/artwork-refresh` processes at most three stored tokens per paced tick. Recent contenders are prioritized, then older stored tokens. A lease prevents overlapping collectors.
- No Solana RPC calls. Creation transaction signatures, hashes and instruction paths are checked against saved finalized evidence before reading metadata.
- At most 120 metadata request reservations per UTC day, also charged to the existing shared 600/day market allowance. This reduces spare market capacity; it does not raise the allowance. Identical successful content-addressed metadata is reused with its original fetched time and hash.
- Failed metadata is retried after six hours; 429s and exhausted quotas pause the collector. Missing/unsupported links remain explicit. Metadata is bounded to 64KB, ten seconds per request, and redirects are not followed. The authenticated Node relay permits only fixed Pinata IPFS paths and never forwards its local token upstream.
- Public `/api/10x/artwork?addresses=…` reads at most 100 cached mints, without provider calls. The frontend refreshes cached artwork once per visible minute. Images load directly from allowlisted public hosts with no referrer; binary images are not proxied or stored locally.
- Data status shows metadata request reservations, next tick and collection errors. Token pages expose the metadata URL, response hash and original fetched time.

The metadata link is bound to creation evidence. Returned JSON and image content remain third-party metadata; the stored JSON response hash is not an independent validation of an IPFS DAG. External image hosts can remove or change images. Metadata at unsupported origins remains unavailable, and complete image coverage is not guaranteed.

## Validation

- Discovery suite, including nine artwork regressions: passed.
- Local relay tests: passed (2).
- Discovery/app typechecks, app build and performance budget: passed.
- Current and legacy saved election snapshots replayed unchanged, using zero provider requests.
- Local migration applied; existing supervisor restarted only its owned discovery launcher. The timer successfully cached three images on its first artwork tick and continued on the next tick.
- Browser verification shows the actual AODF and AOP artwork prominently on Discover; token detail uses the larger artwork treatment. No eligibility gate or ranking rule changed.

The artwork tests cover saved-evidence tampering, public cache-only reads, authentication, unsupported metadata origins, body limits, redirects, URL allowlists, original timestamps, shared metadata reuse and both request ceilings.

## Operations

The existing local launcher applies the additive migration on startup. No extra environment variables or dependencies are needed. Run `node scripts/discovery-operator.mjs artwork-refresh` for one authenticated paced tick. The existing timer invokes it automatically after market refresh; manual calls cannot bypass pause, lease, cadence or quotas.

References: [DEX Screener image metadata](https://docs.dexscreener.com/api/reference), [Workers practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/), [local D1 migration commands](https://developers.cloudflare.com/d1/wrangler-commands/#migrations-apply). Pump instruction layouts remain pinned to the repository's certified descriptor; no remote program/schema update was made.
