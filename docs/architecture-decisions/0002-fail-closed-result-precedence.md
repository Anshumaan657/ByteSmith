# ADR 0002 — Required analysis fails closed

- **Status:** Accepted
- **Date:** 2026-08-18

## Decision

Result precedence is `error`, `incomplete`, `fail`, `warn`, then `pass`.
Required analyzer error wins over all other states. Required incomplete analysis
or required `not_evaluated` policy prevents pass. Blocking failure applies only
to eligible, enabled, active, non-waived findings.

## Consequences

- Crashes, timeouts, invalid output, and unsafe required execution cannot pass.
- Provider adapters must preserve the ByteSmith state even when provider check
  states are less expressive.
