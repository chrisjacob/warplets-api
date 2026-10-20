# Near-duplicate source-excerpt evidence

21 October 2026 · PRD §7.1; task-map P8a. Local only, zero paid services/provider calls and no deployment. Discovery evidence gates, authorship, visibility, report holds, ranking and reward eligibility are unchanged.

## What is implemented

`/admin/10x#content-duplicates` lets the operator record a short excerpt inspected at an existing submission's canonical source URL. The excerpt and private explanation are separate from the contributor's author claim/commentary. Those fields are never substituted for external content. No post, metadata, image, video or social API is fetched.

Each immutable event binds the submission UUID, source URL, original content hash, excerpt, normalized excerpt hash, inspection assertion, private reason, operator role, recorded time, revision, request hash and predecessor hash. A `RECORD` requires an explicit source-inspection assertion; `WITHDRAW` retains history and excludes that excerpt from subsequent comparisons. Replacement requires withdrawal first.

The operator can compare an active subject excerpt with the **latest fifty other active recorded excerpts across campaigns**, including private/hidden/held submissions. This corpus and its available count are read in one D1 transaction batch. Results expose exact normalized matches, lexical similarity, total matching candidates, top ten matches and explicitly omitted records. A sample of all current recorded excerpts still has incomplete external content coverage; unrecorded posts and unobserved portions remain unknown.

The review is private. Signed contributors cannot record excerpts, inspect these histories or request comparisons. Existing public feeds, contributor histories and public authorship labels do not gain excerpts or private review notes. No automatic rejection, featuring, authorship decision, wallet association or reward action occurs. A reviewer may use this evidence with the existing separate moderation workflow.

## Versioned comparison

`nfkc-char5-jaccard-v1` uses Unicode NFKC normalization, lowercase, removal of formatting characters, letters/numbers with collapsed spaces and sets of overlapping five-character sequences. It requires at least sixty normalized characters and twenty distinct sequences. Raw excerpts are bounded to 600 UTF-16 string units; private reasons to 300.

Similarity is `floor(shared_distinct_sequences * 10000 / union_distinct_sequences)` in integer basis points. The experimental **6500-bps (65%)** threshold only selects review hints. Exact normalized strings are labelled separately. Results sort by descending score, then submission UUID, and show at most ten while reporting the full match count within the sample. This is an unvalidated lexical heuristic, not a production originality or rewards rule.

Punctuation/case/compatibility formatting differences can match. Paraphrase, translation, homoglyph substitutions and selective excerpts can evade it; shared slogans or boilerplate can produce false positives. Media/semantic similarity, source truth, authorship and permission are not certified. Zero matches never means original, safe or eligible.

## Bounds, storage and API

Migration `0032_content_duplicate_evidence.sql` adds one append-only table, unique `(submission_id,revision)`, an action/time index and update/delete denial triggers. New evidence admission first verifies the original submission's retained content history. Subsequent screening reads check content projections and replay every sampled excerpt's complete retained chain; screening is not a full re-certification of every submission's moderation history.

Twenty new `RECORD` events per UTC day are admitted atomically with the expected head revision/hash. Each submission retains at most six events; the final slot is reserved for withdrawal. Withdrawal bypasses the new-record quota. Exact UUID/body retries return the original event, even after withdrawal or at capacity; conflicts/stale concurrent decisions fail. Private content operations now show excerpt quota usage, withdrawals and a ninth bounded storage sample. No automatic deletion is enabled.

- `POST /api/10x/admin/attention/duplicate-evidence`: explicit record/withdrawal with stable UUID, expected revision (`-1` initially), excerpt, inspection assertion and private explanation.
- `GET /api/10x/admin/attention/submissions/:id/duplicate-evidence`: complete retained private excerpt history.
- `GET /api/10x/admin/attention/submissions/:id/duplicates`: read-only bounded comparison artifact; an active subject excerpt is required.

Existing local-runtime, operator bearer, browser-origin and bounded-body guards apply. Responses use `Cache-Control: no-store` and `Vary: Cookie`. Captured raw inputs and the final comparison must fit **2 MiB UTF-8**; oversized inputs fail with 413 rather than returning a misleading partial report. Sampling of fifty candidates is separately declared with the omitted count.

The existing local migration command was used with `--local` and `.wrangler/local`; no remote migration, new binding, secret, remote scheduler or deployment was run. D1 [batch transaction semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) keep subject, sample and available count consistent. Request values use bound statements; SQL identifiers and bounds are code-owned.

## Confidential artifacts and replay

An explicit download captures **all sampled excerpt histories**, including below-threshold candidates, target anchors, algorithm/version, coverage counts, results, limitations and a normalized SHA-256 report hash. There is no automatic download/upload or server-side comparison archive. Store/share the JSON as confidential operator evidence.

```powershell
pnpm exec tsx scripts/verify-content-duplicates.ts C:/path/to/private-comparison.json <independently-retained-checksum>
```

The read-only offline verifier bounds the file read, checks every source-excerpt event/request/normalization hash, target/actor/transition/time/predecessor relationship, active sample ordering, uniqueness and coverage arithmetic, then recomputes all scores, match ordering/counts and the exact top ten. Rehashing false scores or a changed input without a valid retained chain still fails. Output contains counts and hashes only; parser input/excerpts are not printed.

Checksums are not signatures or independent source authentication. A malicious party able to rewrite an unsigned artifact can omit inputs, change asserted database counts and recompute a consistent report. Retain the original checksum independently to detect replacement. Offline replay proves the captured calculation's consistency, not which other records existed in the database or what the external source originally contained.

A case with any excerpt history now exports `content-case-export-v3`, including that submission's complete excerpt history plus its authorship stream (possibly empty), component hashes and event counts. The case keeps its existing one-MiB bound and complete-record semantics. Cross-submission comparisons are captured separately; they are not reconstructed from a changing corpus during case export. Cases without excerpt events still use v1/v2, and earlier artifacts retain their original replay/hash formats.

## Verification

- **676 discovery tests across 44 files passed**, including 24 lexical/replay tests and sixteen persistence/route/sampling/export cases added to the 88-test content suite. Hand-counted five-gram vectors certify exact, near and unrelated scores. Tests cover Unicode compatibility/formatting, insufficient/repetitive evidence, top-ten/total counts, omitted sampling, rehashed false results, altered input/request hashes, target/actor/order/coverage/time corruption, active/withdrawn states, concurrent admission, exact retry at quota, UTC reset, immutable six-event history, two-campaign sampling, byte bounds, confidentiality and unchanged moderation/hold/reward behavior.
- **Thirteen content UI tests passed** across two files. They cover gated controls, escaped excerpts and private notes, safe links, manual authorship labels and zero-match/coverage wording. Discovery/app typechecks and the app build passed. Home startup remains **233.9 KiB gzip**, within budget; the lazy content/moderation chunk is 73.03 KB / 18.84 KB gzip. OpenAPI now has **87 paths**.
- The disposable Workerd/D1 signed flow verified real HTTP excerpt admission and exact retry, private history/comparison access, a hand-counted **8387-bps** similarity, withdrawal dropping later comparison coverage from one to zero, frozen offline report replay and rejected independent checksum mismatch. V3 case export and its offline CLI replay passed with authorship and excerpt histories while earlier content/follow-up records remained unchanged. No provider calls, user-wallet use, main preview content writes or deployment occurred.
- Actual retained artifacts from earlier milestones passed the updated case verifier: v1 checksum `84034c2f9a9ca842b9d87bdb0545346337f63da462d1aaee95a3ab5a6218ea59` and v2 checksum `fba1f308c097847c064782338d6970501ad3c0fd9a91f8d6ec9376235409d44b` stayed unchanged.
- Existing read-only local security checks passed: fifteen private requests denied, ten admin browser/body checks and signed action sessions required. Local operations reported empty main preview content storage, zero excerpt records/withdrawals and twenty available new-excerpt slots. Browser review through the existing tunnel verified the private panel, disabled UUID/load controls without a token and explicit source/media/sampling limitations.

Commands run from the repository root:

```powershell
pnpm --dir discovery exec wrangler d1 migrations apply TENX_DB --local --config wrangler.local.jsonc --persist-to .wrangler/local
pnpm --dir discovery test
pnpm --dir discovery typecheck
pnpm --dir app typecheck
pnpm --dir app exec vitest run src/discovery/ContentDuplicates.test.tsx src/discovery/AttentionContent.test.tsx
pnpm --dir app build
pnpm exec tsx scripts/check-attention-content-local.ts
pnpm exec tsx scripts/check-content-operations-local.ts
node scripts/check-tenx-security-local.mjs
```

Tests use synthetic text and disposable signed identities in a separate local runtime/database; the main preview content tables are not seeded. No new configuration toggle is required. Existing local-only, free-provider caps and disabled financial/publication capabilities remain in force.

## Remaining PRD work

Authenticated external content ingestion with permitted use; image/video/audio/semantic similarity; validated originality thresholds and false-positive review; source-account proof; real qualified attention inputs and rewards; controlled archive/restore and approved retention. This completes scoped local excerpt evidence, not comprehensive plagiarism detection. The ten eligible recent-token target is unaffected and remains open.
