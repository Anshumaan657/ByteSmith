# Phase 6E Review Checklist — Test Recommendations and Gaps

## Review scope

This branch converts Phase 6 consumer impacts and Phase 6D Jest/Vitest
discovery into bounded, manifest-ready test recommendations and explicit test
gaps. It depends on the Phase 6D commit and leaves complete ChangeBench wiring,
precision/recall measurement, and performance validation to Phase 6F.

## Evidence-backed linkage

- [x] Accept only consumer, discovery, and canonical IR inputs bound to the same
  repository and exact base/head revisions.
- [x] Prefer authoritative test calls and references to affected consumers.
- [x] Rank direct symbol and module imports below direct references.
- [x] Include consumer-path, relationship, and test-discovery evidence in every
  authoritative recommendation.
- [x] Fold a terminal test-file consumer path back to its nearest non-test
  consumer before ranking.
- [x] Group multiple terminal tests by the behavior they cover instead of
  recommending tests for themselves.

## Conservative fallback ranking

- [x] Use test-name and filename overlap only as labeled low-confidence
  evidence.
- [x] Label co-located directory evidence as low confidence.
- [x] Use workspace package ownership only as low-confidence package evidence.
- [x] Never allow naming, directory, or package convention evidence to be
  represented as authoritative.
- [x] Select the highest-scoring evidence tier and order equal candidates
  deterministically.
- [x] Retain rank, score, confidence, signal, affected-component, and source
  impact metadata outside the frozen manifest recommendation shape.

## Recommendations and commands

- [x] Emit the frozen `ManifestTestRecommendation` structure.
- [x] Use the exact repository-owned runnable command discovered in Phase 6D.
- [x] Preserve the exact test file, test name, revision, and source location.
- [x] Explain the affected consumer in every recommendation reason.
- [x] Deduplicate recommendations by stable semantic ID.
- [x] Enforce a configurable positive recommendation limit.
- [x] Convert relevant limit truncation into a visible possible unknown.

## Test gaps

- [x] Emit one immutable gap per affected component when no supported runnable
  recommendation was found.
- [x] Always use `gapKind: not_found` in Verify 0.1.
- [x] Include the exact lower-case wording “no test found.”
- [x] Never state or imply “no test exists.”
- [x] Preserve affected-component and consumer evidence in every gap.
- [x] Report a linked test without a supported repository-owned command as a
  gap plus an explanatory diagnostic.

## Determinism and safety

- [x] Validate every referenced evidence ID before returning a result.
- [x] Use stable IDs for recommendations, gaps, evidence, and unknowns.
- [x] Sort semantic sets and calculate a deterministic semantic digest.
- [x] Reject stale and cross-repository inputs before ranking.
- [x] Never execute, skip, generate, or mutate tests.
- [x] No coverage, history, Playwright, network, or AI-based ranking is added.

## Validation

- [x] The `relevant-test-selected` ChangeBench fixture ranks exactly
  `checkout total test` with a command containing `checkout.test.ts` and a
  reason naming `checkoutTotal`.
- [x] The `affected-consumer-no-test` fixture produces exactly one `not_found`
  gap for `notifyCustomer`.
- [x] A convention-only fixture produces low-confidence heuristic evidence.
- [x] A linked test without a runnable command produces a gap.
- [x] Equal-ranked candidates obey the configured bound and expose truncation.
- [x] Repeated runs produce deeply equal results and semantic digests.
- [x] Mismatched revisions are rejected with a stable error.

## Full quality gate

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

## Expected review result

- Every recommendation has a reproducible command, affected-consumer reason,
  and inspectable evidence.
- Convention-only evidence is visibly low confidence.
- Missing or unrunnable test evidence is described only as “no test found.”
- Phase 6F integration and measured test-selection recall remain intentionally
  unimplemented.
