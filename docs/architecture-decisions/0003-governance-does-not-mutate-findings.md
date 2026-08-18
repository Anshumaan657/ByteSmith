# ADR 0003 — Governance records do not mutate findings

- **Status:** Accepted
- **Date:** 2026-08-18

## Decision

Impacts and test gaps are immutable findings. Appeals, waivers, suppressions,
and other dispositions are separate records referencing finding IDs and audit
events. Waiver scope is always explicit and conditional fields are validated.

## Consequences

- Historical evidence remains reproducible.
- Active waivers yield at least warning.
- Expired/revoked waivers reactivate still-applicable findings on re-evaluation.
- Organization waivers require elevated approval.
