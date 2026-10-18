# Network performance, security and cost review

Reviewed 18 October 2026. Changes are local-preview only; production remains gated off.

## Implemented

- Aggregate country/token rows with maps rather than repeatedly scanning the
  full cell set and token catalog. Group acceptance history in one pass too.
- Cache validated public dashboard, directory and history responses for 60
  seconds in the namespaced `network-public-v1` Cloudflare Cache API store.
  A hit bypasses D1 entirely. Dashboard requests no longer read/write KV.
  Cache keys include the host, resource and canonical selection; arbitrary
  query strings cannot generate additional entries for the same selection.
  Browser freshness is 30 seconds; the serving flag is checked before caching.
  Errors are not cached, and database failure details are not returned publicly.
- Reject unknown/duplicate query parameters and oversized queries before reads.
- Tracker refresh reads existing identities/candidates once and writes only
  changed identities/new candidates. It preserves official-client precedence.
  Identity `observed_at` records when that presentation was observed/changed;
  `candidate_refresh` records the last successful whole-feed check. Candidate
  `observed_at` now stays at first discovery rather than being rewritten.
- Pause automatic chain retries for 15 minutes after source failure while
  continuing official profile enrichment. An explicit scan can bypass the pause.
- Network HTML uses its own CSP: self-hosted scripts, same-origin connections,
  HTTPS avatars, no eval/inline scripts, no frames/objects/forms. Other apps keep
  their own policies. Inline styles remain allowed for React map/chart styling.

## Measured result

Saved local real snapshot: 2,179 aggregate cells and 1,496 canonical profile
tokens. Ten repetitions of five selections (global, Australia, unknown location,
no token, opted out), including dashboard construction and JSON serialization:

| Measurement | Before | After |
| --- | ---: | ---: |
| Average time per dashboard | 46.1 ms | 11.9 ms |

All five outputs matched the saved baseline byte for byte. This is about 3.9x
faster aggregation, not a claim about public page load or production latency.
Actual dollar savings are not estimated without production request/row metrics.

## Next priorities

1. Finish independent chain reconciliation with an available existing RPC/log
   source. Only the independently dated subset contributes to adoption history.
2. Apply host-scoped API rate limiting before production traffic; edge caching
   reduces repeat queries but does not stop many distinct legitimate searches.
3. Serve a versioned token catalog separately: the measured dashboard response
   was about 443 KB uncompressed, including 1,496 token metadata entries.
4. Consider cached, resized avatars after measuring image transfer sizes. Keep
   arbitrary user URLs out of a server-side image proxy unless it enforces
   approved origins, bounded content/size, timeouts and redirect rules.
5. Add source freshness/budget alerting through the existing operations system,
   and confirm supported long-term profile-source access before public release.
