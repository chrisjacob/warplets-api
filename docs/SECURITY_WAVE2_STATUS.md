# Security Wave 2 Status

Last updated: 2026-05-08

## Completed (implemented in code)

- [x] Scoped admin auth model with explicit legacy fallback opt-in (`ADMIN_ALLOW_LEGACY_TOKEN=1`)
- [x] Admin auth audit logging (including legacy token usage events)
- [x] KV-backed rate limiting on high-risk write/admin endpoints
- [x] Security audit event persistence (`security_audit_events`)
- [x] Security telemetry API (`GET /api/security/stats`)
- [x] Security alert API with thresholds (`GET /api/security/alerts`)
- [x] Admin UI security panel + alert table wired to telemetry APIs
- [x] Strict request payload shape enforcement on high-risk write endpoints
- [x] Bounded JSON body size limits on high-risk write endpoints
- [x] Outbound fetch policy wrapper (allowlisted hosts, timeout, retry)
- [x] Webhook replay/stale guard protections with audit telemetry
- [x] Deploy and PR CI security gates (`security:preflight` + typechecks)

## Completed (configuration / workflow)

- [x] Env/data isolation for prod/dev/preview D1 + KV bindings
- [x] Security preflight integrated into deploy scripts
- [x] Security checklist issue template added

## Remaining operational follow-up (non-code)

- [ ] Ensure `ADMIN_API_KEYS_JSON` is set per environment with least-privilege scopes
- [ ] Keep `ADMIN_ALLOW_LEGACY_TOKEN` unset/`0` in prod
- [ ] Rotate `ACTION_SESSION_SECRET` and admin keys on a schedule
- [ ] Add external alert delivery integration (Slack/email/PagerDuty) from telemetry
- [ ] Run incident response tabletop against the new controls

## Recommended next (Wave 3)

- Signed context verification expansion for more endpoints
- Data retention and PII minimization policy enforcement
- Periodic automated abuse tests + dependency/SAST checks
