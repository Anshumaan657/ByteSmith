# ByteSmith semantic validation

## Validation order

1. Parse JSON without duplicate object keys.
2. Validate against the declared Draft 2020-12 schema.
3. Run the cross-field rules below.
4. Derive and compare the result state.
5. Canonicalize and verify the semantic digest.

Any failure makes the manifest invalid and prevents authoritative publication.

## Identity and references

- IDs are unique within each top-level collection.
- Evidence references resolve to `evidence`.
- Impact source changes resolve to `changes`.
- Policy, waiver, appeal, and disposition finding IDs resolve to an impact or
  test-gap finding.
- Analysis-gap references resolve to `unknowns`.
- Suspension references resolve to `suspensions` and match rule/version.
- Governance audit references resolve to `auditEvents` for the same entity.

## Coverage

- `totalChangedFiles` equals `scope.files.length`.
- Bucket totals sum to `totalChangedFiles`.
- Each reported bucket count equals the actual file-class count.
- Changed paths are unique, repository-relative, normalized paths.
- `previousPath` is present for renames/copies and absent otherwise.
- Unsupported and intentionally excluded files have a reason.

## Evidence and authority

- Every change and impact has at least one resolvable evidence ID.
- Heuristic impacts cannot be the sole finding for an enabled blocking failure.
- Evidence repository/revision agrees with manifest repository and either base
  or head revision.

## Suspensions

- `ruleState: suspended` requires an active matching suspension.
- A safely evaluated suspended policy returns `warn` and retains findings.
- An unsafe suspended policy returns `not_evaluated` and references at least one
  unknown/analysis gap.
- A suspended policy never returns `pass` or `fail`.
- Repository and organization suspension identities match the manifest context
  when applicable; scope is never widened by inference.

## Waivers

- `startsAt < expiresAt`.
- `active` is valid only when manifest `generatedAt` is within the interval.
- `expired` is not treated as active even if its interval was formerly valid.
- Scope-dependent identity, selector, and elevated approval fields satisfy the
  schema and match the applicable repository/organization context.
- A waiver does not alter the original finding.
- An active waiver forces at least `warn`.

## Appeals and audit

- A terminal appeal includes outcome, adjudicator, adjudication time, rationale,
  and a matching terminal audit event.
- Nonterminal appeals do not claim a terminal outcome.
- Workflow audit transitions are internally consistent and entity-bound.

## Result and integrity

- The conclusion equals the precedence algorithm in `result-states.md`.
- A required error/incomplete/not-evaluated condition cannot validate as pass.
- A suspended finding or active waiver cannot validate as pass.
- Digest algorithm is `sha256` for schema `1.0.0`.
- Stored digest equals the digest of `bytesmith-c14n-1` canonical semantic bytes.
