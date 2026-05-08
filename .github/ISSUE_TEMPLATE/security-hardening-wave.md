---
name: "Security Hardening Wave Task"
about: "Track a scoped Wave 2/3 security hardening task"
title: "[Security] "
labels: ["security", "hardening"]
assignees: []
---

## Summary
Describe the specific risk this task reduces and the affected surfaces.

## Wave
- [ ] Wave 2
- [ ] Wave 3

## Category
- [ ] Auth / Authorization
- [ ] Abuse / Rate Limiting
- [ ] Validation / Input Hardening
- [ ] Secrets / Key Management
- [ ] Release / CI Safety
- [ ] Telemetry / Incident Response
- [ ] Webhook / Replay Protection
- [ ] Outbound Dependency Controls

## Risk Statement
What can go wrong today if this is not fixed?

## Scope (Decision Complete)
- In scope:
  - 
- Out of scope:
  - 

## Implementation Checklist
- [ ] Code changes implemented
- [ ] Config/secret changes documented
- [ ] Local/dev/prod behavior verified
- [ ] Security headers/validation/rate-limit expectations verified (if applicable)
- [ ] Backward compatibility assessed

## Test Plan
- [ ] Positive path
- [ ] Negative path / misuse path
- [ ] Regression checks

## Rollout Plan
- [ ] Deploy to dev
- [ ] Verify telemetry + logs
- [ ] Deploy to prod
- [ ] Post-deploy validation complete

## Acceptance Criteria
- [ ] Risk is measurably reduced
- [ ] Monitoring/alerts cover the new control
- [ ] Docs/runbook updated

## Notes
Add links to PRs, dashboards, and incident/runbook docs.
