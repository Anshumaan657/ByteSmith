# ADR 0005 — Canonical semantic digest uses bytesmith-c14n-1

- **Status:** Accepted
- **Date:** 2026-08-18

## Decision

Semantic equality uses `bytesmith-c14n-1`: remove only documented runtime
fields, normalize strings/paths/timestamps, sort declared semantic-set arrays,
serialize compact canonical JSON, and hash UTF-8 bytes with SHA-256.

## Consequences

- Reordered semantic sets do not change the digest.
- Conclusion-relevant changes do change the digest.
- Digest verification is a mandatory semantic-validation step.
