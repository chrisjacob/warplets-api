# Security Wave 3 Status

Last updated: 2026-05-08

## Completed

- [x] Security audit PII minimization:
  - IP addresses are stored as salted hashes via `SECURITY_LOG_SALT`.
  - Audit text fields are sanitized and length-bounded.
- [x] Security audit retention controls:
  - `POST /api/security/retention-run` added.
  - Dedicated `security:manage` scope.
  - Bounded retention window (`7..180` days).
  - `dryRun` support.
  - Endpoint rate limiting.
- [x] Automated security cadence:
  - Dependabot enabled (`.github/dependabot.yml`).
  - Nightly security workflow (`.github/workflows/security-nightly.yml`).
  - CodeQL SAST workflow (`.github/workflows/codeql.yml`).
- [x] Signed identity expansion:
  - `/api/notifications/open` now prefers signed action session tokens.
  - `/api/email/subscribe` now prefers signed action session tokens.
  - Drop client sends `sessionToken` for notification-open and waitlist subscribe.
- [x] Security smoke checks:
  - `pnpm security:smoke` for quick authz/header/trust-boundary checks.

## Remaining (recommended next)

- [ ] Add alert delivery sinks (Slack/email/PagerDuty) for security alerts.
- [ ] Add periodic key-rotation reminder automation and evidence logging.
- [ ] Add integration tests for scoped admin keys across all admin endpoints.
- [ ] Add rollback drill + incident tabletop checklist execution record.
