# ADR 0001 — Impact Manifest is the shared contract

- **Status:** Accepted
- **Date:** 2026-08-18

## Decision

CLI, GitHub Action, and any future interface use one versioned Impact Manifest,
one result derivation, and one canonicalization algorithm. Interface adapters
may change presentation but not the ByteSmith conclusion.

## Consequences

- The shared schema is frozen before public package APIs.
- Unsupported major schema versions are rejected.
- Interface-specific output must retain manifest revision, versions, and status.
