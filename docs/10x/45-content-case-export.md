# Private moderation case export

21 October 2026 · PRD §§9, 12, 14 and 15; task-map P8a. Local only, free services, no deployment. All discovery evidence gates and content admission limits remain unchanged.

## Implemented

The operator can request a submission UUID at `/admin/10x#content-case-export`, inspect verified event/report/follow-up counts and explicitly download confidential JSON. Nothing is fetched automatically for this panel. Removing or replacing the token hides the artifact, aborts the request and discards late responses. No operator token, session cookie, wallet signature or wallet private key enters the export. The summary does not render reporter claims, notes or external embeds.

`GET /api/10x/admin/attention/submissions/:id/export` requires existing local-runtime, operator bearer and browser-origin admission. Signed contributors cannot use it. Responses use `Cache-Control: no-store` and `Vary: Cookie`; missing cases return 404. The endpoint has no write path, migration, external provider request or moderation side effect.

One D1 transaction batch reads the submission, campaign, all reports and all contributor hold reviews with their ordered immutable histories. The [D1 batch contract](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) supplies transactional execution. Each existing pure history decoder verifies the same projections, event hashes, predecessor links, actor roles, transitions and immutable content relationships used by ordinary reads. The extraction preserves existing records and hash formats.

The artifact includes:

- Full campaign and submission review history, including private operator reasons.
- All retained reports, reporter identity IDs, claims, references and review history.
- All retained contributor hold-review requests, responses and closure history.
- Featuring hold state derived from the captured reports, component counts/hashes and a normalized payload SHA-256 checksum.

Records are ordered by UUID. At most ten reports, twenty follow-ups, twenty content events, three events per report and four per follow-up are accepted. SQL requests one additional record/event to detect overflow; it never silently truncates an accepted case. Both the raw read payload and final compact JSON must fit 1 MiB measured as UTF-8 bytes. Exceeding a case bound returns 413 without a partial artifact; it does not change intake limits or remove data. The raw-payload bound can reject a case before the compact artifact would reach 1 MiB.

Closing a contributor conversation does not release an upheld report. Each independent report hold must still be separately reviewed. The export reflects its capture time; it is not a live visibility subscription.

## Offline verification and its limits

Run from the repository root:

```powershell
pnpm exec tsx scripts/verify-content-case-export.ts C:/path/to/private-case.json
pnpm exec tsx scripts/verify-content-case-export.ts C:/path/to/private-case.json <separately-retained-sha256>
```

The verifier reads at most 1 MiB plus one overflow byte, then verifies the normalized artifact checksum, component manifest, full event replays, campaign/target/owner relationships, capture-time bounds, ordered unique case IDs and derived featuring hold. It makes no network/database requests or writes. Output contains counts and hashes only; errors omit parser input so confidential claims are not printed.

A checksum is **not a digital signature**. The export cannot prove real-world authorship, allegation truth, historical engagement or reward eligibility. A malicious party can omit a record and recompute an internally consistent unsigned artifact; retain the original checksum independently to detect replacement or omission. Offline verification alone cannot certify completeness against the original database. The server export includes every retained related row at its read snapshot, within the explicit bounds.

Historical `hold_set_hash` values remain frozen and verified in their original chains. They are not recomputed from today's reports: later decisions can change that set, and a checksum alone is not an independent proof of historical set membership.

The JSON is a confidential operator artifact. Download is explicit and local; distribution, secure storage and retention remain the operator's responsibility. There is no automatic cloud upload, archive scheduling, deletion, retention-policy selection or reward credit.

## Verification

- **616 discovery tests across 43 files passed**, including eighteen new export cases within the 52-test content suite. Cases cover independent report holds, closure without release, concurrent review snapshots, read-only operation, database-free replay after close, access/origin/local admission, missing/invalid targets, checksum and independently rehashed history/relationship/manifest tampering, ordering/duplicates, oversized record counts and UTF-8 size bounds.
- **Five content UI tests passed**; discovery typecheck and app typecheck/build passed. Startup remains **233.9 KiB gzip**, within the existing performance budget. Content/moderation code remains lazy; no server replay code is imported by the UI. OpenAPI now has **81 paths**.
- The disposable Workerd/D1 signed flow passed: real HTTP export contained eight history events, one private report and one four-event contributor follow-up; its featuring hold remained active after conversation closure. The offline CLI accepted the retained checksum and rejected a different independently supplied checksum. A separate operator report release changed current hold state without rewriting content or follow-up histories. Zero provider requests, user-wallet use or main preview database writes occurred.
- Existing read-only local security checks passed: fifteen private requests denied, ten admin origin/body checks and signed action sessions required. Browser review through the existing tunnel verified that the UUID input and export action remain disabled without the operator token, with no confidential download or private record displayed.

The reusable isolated check is `pnpm exec tsx scripts/check-attention-content-local.ts`. It uses disposable signed identities and a separate local database, exercises the real HTTP export and offline CLI, then separately releases a report hold. It never seeds the main preview content tables or uses the user's wallet.

## Remaining P8a work

Controlled archival/restore and an approved retention policy; source-specific authorship; near-duplicate content evidence; validated attention/referral/boost inputs; actual reward entitlements and claims. This bounded case export completes one operational capability, not the full content/rewards package. The ten eligible recent-token target remains unmet and is unaffected by this milestone.
