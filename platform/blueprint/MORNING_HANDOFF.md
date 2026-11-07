# Current implementation handoff

Branch: `work/10x-prd-foundation`. Latest tested local integration checkpoint: `6e3666dc4ac00e2d642d0cfd2f4412337ae02c22`. Preserve untracked `work/` scratch. Earlier checkpoint history remains in Git and the task evidence directory; this document describes current state only.

## Progress and next executable step

B00–B17 and B19 are verified. Combined CI [42314862967](https://github.com/chrisjacob/warplets-api/actions/runs/42314862967) passed at `ee02bbd36cbf257e0cb81a2e4485e5cc93710a66`: 1,218 reference + 30 viewer + 3 beacon + 169 Worker/D1/R2 = 1,420 tests, zero failures. Builds, types, generated contracts and recovery drill passed. Exact evidence: B17-B19-ci.json.

B18 focused acceptance passed at `7deb2628c0934b469d113d089dc311240ab834cf`: eight pure compatibility tests, 30 site tests, build and complete browser QA including 48 new wallet boundary groups at four widths. Fourteen machine-readable evidence rows preserve physical/marketplace gaps. B18 has no production UI changes. B20-full local acceptance is complete; final combined [CI42322879462](https://github.com/chrisjacob/warplets-api/actions/runs/42322879462) at6e3666d includes B18, fixture-clock repairs and new load checks. Watch session65802; log `work/ci-42322879462.log`. Follow to final; do not cancel with another marker. Do not repeat core merely because B20 remains in progress.

Current estimates: 398/411 points implemented, 13 remaining; 390 strictly verified. User stop cap is 50% account usage; latest observed 12%. Ten-campaign attempted-load, integrated journey review and all58 traceability are complete. Next follow final CI, record exact results, then finalize the guide and mark full profile complete. No R-stage work.

## Recent validation

The local full reference run at ee02bbd completed 1,218 tests: 1,214 passed and four historical fixture setup failures. This is not a full local pass. Those four failures are repaired in 9e8c604 by sharing the original historical clock across JavaScript and SQL fixture setup. All 21 affected Node tests and two actual Worker/D1 tests pass. No production clock, lease guard or expiry behavior changed. CAST/ROUND diagnostics did not demonstrate a conversion bug. The fixture-only repair is newer than prior CI42314862967 and included in final CI42322879462.

B19 acceptance: 32 focused tests plus actual full private Vault restoration passed. The compact archive index references 15 required tables; full restoration retained 185 objects in 1,149 steps with a 129,652-byte peak checkpoint under the unchanged 131,072-byte bound. Claim history, partial claims through transfer, expired Season history and unminted obligations survive restoration. Public commitments omit private allocation/ownership data. Program Merkle-vector gaps and production custody remain unresolved.

Bounded independent B17 and B19 reviews found no additional actionable defects; these reviews are not substitute test runs. Evidence is under `platform/validation/runs/2026-11-06-overnight/`, particularly B17-ci-repair.json, B17-clock-fixtures.json and B19-acceptance.json. Schema is 069, 118 business tables; next migration 070 is unreserved.

## Local preview and review artifacts

From the repository root, use installed dependencies:

```powershell
pnpm --dir platform/site build
node platform/scripts/rehearse-hosted-slice.mjs
```

The runner prints a disposable loopback Earn URL backed by actual local workerd/D1/R2. See `platform/scripts/HOSTED_REHEARSAL.md` for fixture-clock limits and browser verification. Broader role walkthroughs use the recorded local demo described in the guide; do not mistake the narrower hosted Earn rehearsal for every implemented route.

Current chat outputs contain `10x-progress-and-manual-review.md` and draft `10X_MEME_User_Guide.pdf` / `.html`. The guide has 16 pages and nine actual fixture screenshots covering visitor, member, operator, founder and recovery workflows; all pages were visually checked. Update its completion status after B18/B20 before final delivery. Generator: current chat `work/user-guide/build.py`; agent user_guide can update it.

## Boundaries and remaining release work

Financial execution, transaction signing and broadcast remain disabled. No deployment, remote Cloudflare resource writes/provisioning, spending, wallet funding, subscriptions, external messages, main/dev merge or force push. Sydney launch hours and later mint prices remain open.

Release still requires separately authorized custody/burn/update-authority decisions, complete allocation backing from the first funded ATT, reserve assignment and payment/order fairness, matching claim-program proofs, farm principal protection and fractional precision, provider/cost review, physical wallets/marketplace execution, staffed operation and deployment approvals. Local fixture success does not clear these gates. See the six release gates and financial decision dossiers.
