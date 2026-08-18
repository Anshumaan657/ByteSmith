# ADR 0004 — Suspension disables enforcement, not visibility

- **Status:** Accepted
- **Date:** 2026-08-18

## Decision

Suspended rules cannot block but their findings remain visible. Safe execution
returns warning; unsafe execution returns `not_evaluated` with explicit gaps.
Suspension scope is repository, organization, or global and is never widened by
inference.

## Consequences

- Suspension cannot create a clean pass from a visible problem.
- Required unsafe evaluation derives incomplete.
- Every suspension has reason, actor, evidence, criteria, and audit trail.
