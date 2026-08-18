# ADR 0006 — ChangeBench is exhaustive by default

- **Status:** Accepted
- **Date:** 2026-08-18

## Decision

Every case explicitly declares `allowUnexpected`. When false, unmatched changes,
impacts, tests, unknowns, policies, or waivers fail the case and count as false
positives. When true, a rationale is mandatory.

## Consequences

- Positive-only fixtures are non-conformant.
- Blocking-rule fixtures normally use false.
- Metrics are segmented per rule and pack so aggregates cannot hide weak rules.
