# Phase 0 review checklist

## Review command

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm phase0:check
```

## Exit-gate evidence

- [x] Three schemas declare and compile as JSON Schema Draft 2020-12.
- [x] Cross-field semantic validation is specified and implemented as a
      non-public reference prototype.
- [x] Required analyzer `error` and `incomplete` cannot derive `pass`.
- [x] Suspended findings remain visible when safe execution is possible.
- [x] Unsafe suspension emits `not_evaluated` and explicit analysis gaps.
- [x] Required unsafe evaluation derives `incomplete`.
- [x] Repository, organization, and global suspension scopes are distinct.
- [x] Waiver scopes are explicit and conditionally validated.
- [x] Organization waiver requires elevated approval.
- [x] Active waiver derives at least `warn` and does not mutate the finding.
- [x] Expiry/revocation followed by re-evaluation reactivates a still-applicable
      finding.
- [x] Appeal creation, review, terminal adjudication, and audit trail are tested.
- [x] Terminal appeal outcomes are `upheld`, `rejected`, and `superseded`.
- [x] `allowUnexpected` is required; true requires rationale; false counts
      unmatched results as false positives.
- [x] Canonicalization and SHA-256 semantic digest are specified and tested for
      determinism, idempotence, runtime-field exclusion, and semantic changes.
- [x] Original findings and governance dispositions are separate.
- [x] CLI and GitHub reporting obligations are specified for later interface
      implementation.
- [x] Correction-focused ChangeBench fixtures validate deterministically.
- [x] Six ADRs record the frozen decisions.

## Reviewer decision

- [x] Approve schema version `1.0.0` as the Phase 0 freeze.
- [ ] Request changes before freeze.

No public package API is frozen by this phase. The code under `scripts/lib/` is a
behavioral reference prototype for later production packages.
