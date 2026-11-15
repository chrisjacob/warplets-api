# Supported posts and review capture

New submissions through the Node and Worker HTTP runtimes accept **shared Farcaster or X post links**. Profiles, feeds, arbitrary websites and redirect URLs are refused. Paste the shared post link into Earn → Submit content; choose the campaign, submit, then use **View post** in your submission history. Daily leaderboard winners also have **View winning post**. Views load only when clicked.

The card displays source-labelled text, the source author's public display name, the read/save time and an original-post link. It does not execute provider HTML, load third-party scripts, or fetch embedded media/links. An accepted domain does not establish safety, quality, wallet authorship or reward eligibility. A public preview is not a score. Failures show unavailable, never a zero score.

## Access and historical compatibility

- Pending and nonwinning submissions are private to their wallet. Public access requires the exact submission ID and wallet on an immutable final board **and** its qualified decision. A final human review or a different winning submission from the same wallet is insufficient.
- Owner views may use a verified stored operator capture. Anonymous viewers and other wallets always receive a fresh public-source preview; private capture text, project context and evidence references are never shared through that public path.
- Recovery holds deny reads, including when recovery changes during a source read. Responses are `no-store`; source reads are limited to six requests per minute per authenticated wallet, or one shared anonymous bucket in this local implementation.
- Older unsupported URLs and immutable request replays remain valid historical evidence. They are not presented as supported external links. Internal synthetic admission fixtures remain explicit and can use `.invalid`; there is no HTTP override for that test seam.
- The form submits normalized post identities. Source readers normalize X host/username/share aliases and Farcaster host/share aliases. Generic persisted URL encoding and historic request digests are unchanged; direct API callers retain the existing per-wallet/token/day admission and idempotency rules. This is not global cross-alias or cross-wallet post deduplication.

## Current source support

| Source | In-app public preview | Automated trusted capture |
| --- | --- | --- |
| Farcaster | Public cast text from the fixed `client.farcaster.xyz/v2/thread-casts` endpoint, bound to the requested hash and username | Local operator command below accepts complete text only, with every attachment bucket empty. Links, images, video, quoted casts, missing/unknown attachment shapes require manual review. |
| X | Plain text extracted from the fixed `publish.x.com/oembed` endpoint; always labelled an excerpt | Refused: oEmbed does not establish complete text/media. Obtain approved full API access or a complete authorized manual capture before scoring. |

Both adapters use HTTPS fixed endpoints, refuse redirects, omit credentials, time out after eight seconds per request and limit each JSON response to 262,144 bytes. A public preview makes one request. Trusted Farcaster capture can make one additional fixed recent-cast request (validated numeric author FID, limit 20) when the thread omits attachment metadata. It binds the exact full hash, username, FID, text and timestamp, then requires explicit empty attachment buckets. There is no pagination or retry; out-of-page, mismatched or incomplete responses require manual capture. They never fetch the submitted URL itself or source-provided links. Farcaster public text is limited to 20,000 characters; source receipt hashes bind the actual response bytes. Provider output remains untrusted text.

The Farcaster client endpoint was verified with a public uncredentialed read on 2026-11-15, including a real text-only cast whose thread omitted `embeds` while the recent-cast response explicitly supplied five empty attachment arrays. The capture adapter successfully reconciled the two responses in two reads; no database write or scoring was performed during this verification. The client endpoint is not a documented stable protocol API or cryptographic verification of a cast. Availability, rate limits and schema changes can hold a review. The official X [embedding guide](https://help.x.com/en/using-x/how-to-embed-a-post) and [Publish interface](https://publish.x.com/) explain public embedding; full [post API access](https://developer.x.com/apitools/api?endpoint=%2F2%2Ftweets&method=get) is a separate dependency. No provider credentials or paid calls were used to implement or test this feature.

## Local operator: capture a complete Farcaster text post

Use an existing operator with an active `ai-review` database grant, an `awaiting-capture` job from the queue, a UTF-8 file containing trusted project context (at most 8,000 characters), and a **new** receipt filename:

```powershell
node platform/ai-review/capture-post.mjs --database work/demo.sqlite --operator-id YOUR_OPERATOR --job-id "submission:SUBMISSION_ID" --context work/project-context.txt --receipt work/post-source-receipt.json
```

This command performs one or at most two bounded public source reads and saves both response hashes when supplemented, source identity, timestamps and the input hash to the receipt. The stored evidence reference binds the digest of the complete combined source receipt, so changing either response changes the evidence reference. It stores the complete captured text in the existing durable private queue capture. It does not copy arbitrary HTML or truncate evidence. Existing receipt files are never overwritten. A receipt may remain if a concurrent operator revocation, board closure or recovery hold prevents the subsequent capture; inspect the queue status before retrying. The command does not grant operator authority.

**Real captured jobs stay `held` with `provider-disabled`.** No model calls, synthetic stand-in scores, automatic final reviews, awards or settlement are performed. The separate synthetic fixture evaluator must never score a real post. Private capture data remains covered by the existing recovery-safe row-size preflight.

## Remaining launch decisions

Approve reliable source access/retention terms, authorship verification and cross-wallet duplicate-content policy; complete image/video/quoted-post transcripts and private/deleted-source handling; choose and budget a real scoring provider; calibrate the rubric; agree independent review/appeal and final authority policies; implement approved durable Worker model processing and unknown-outcome reconciliation. AI is not inherently unbiased, and no quality claim follows from deterministic fixture tests.

## Validation

`node --test platform/earn/supported-post.test.mjs platform/earn/post-content.test.mjs platform/ai-review/capture-post.test.mjs` covers URL/parser boundaries, replay compatibility, fixed/redirect-free fetches, byte caps, author/hash mismatch, attachment uncertainty, X excerpt rejection, capture receipts, private/public isolation, recovery races, tampered evidence and HTTP quotas. `platform/edge/test/earn-http.test.mjs` exercises strict intake on actual Node/workerd runtimes; the Worker feedback test checks private saved content without external reads.

The isolated `platform/site/tests/post-content-qa.mjs` browser test submits an inert X identity against a synthetic source adapter, checks invalid-link feedback, lazy loading, escaped text, keyboard focus, mobile overflow, published anonymous access and absence of scoring/capture writes. It never submits or scores another person's actual post.
