# Phase 6F Review Checklist — Consumer and Test Integration

## Review scope

This branch completes Phase 6 by joining TypeScript and OpenAPI contract
changes, bounded consumer linkage, Jest/Vitest discovery, test recommendations,
test gaps, unknowns, and evidence into one exact-revision result. It also turns
the Phase 6 exit criteria into executable quality metrics.

## Integrated execution

- [x] Provide a public TypeScript integration entry point.
- [x] Provide a public OpenAPI integration entry point.
- [x] Require valid canonical IR and matching repository/base/head bindings.
- [x] Run consumer analysis, test discovery, and recommendation ranking in the
  documented order.
- [x] Normalize a terminal test file to the nearest non-test consumer it covers.
- [x] Preserve direct versus transitive consumer classification after
  normalization.
- [x] Return one manifest-ready result containing paths, impacts,
  recommendations, decisions, gaps, unknowns, evidence, and diagnostics.

## Evidence and determinism

- [x] Reject any result that references missing evidence.
- [x] Include both contract-analysis and linkage-IR evidence for OpenAPI runs.
- [x] Deduplicate and deterministically order all semantic collections.
- [x] Bind every result to the exact repository, base revision, and head
  revision.
- [x] Calculate a semantic digest that excludes wall-clock runtime.
- [x] Produce identical semantic digests for repeated identical inputs.
- [x] Keep unresolved or truncated analysis visible as unknown/incomplete.

## ChangeBench acceptance cases

- [x] `relevant-test-selected` reports `checkoutTotal`, selects exactly
  `checkout total test`, and returns its repository-owned command.
- [x] `affected-consumer-no-test` reports `notifyCustomer` and one explicit
  `not_found` gap using “no test found,” never “no test exists.”
- [x] `unrelated-consumer-forbidden` excludes `renderAdminDashboard`.
- [x] `transitive-consumer-affected` retains `renderProfile` as transitive.
- [x] A changed OpenAPI request contract links `submitOrder` to its exact client
  test.
- [x] Stale exact-revision bindings are rejected.

## Measured exit gates

- [x] Direct-consumer precision must be at least 90%.
- [x] Test-selection recall must be at least 80%.
- [x] Repeated-run semantic determinism must be 100%.
- [x] Forbidden consumer and test matches must remain zero.
- [x] Every referenced evidence ID must resolve in the integrated result.
- [x] A representative comparison must complete within the 20-second
  development-machine budget.

## Safety boundary

- [x] Test commands are recommended but never executed.
- [x] No repository source or test file is generated, skipped, or mutated.
- [x] No coverage, history, Playwright, network, cloud, or AI dependency is
  introduced.
- [x] Runtime timing cannot change a semantic digest.

## Full quality gate

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

## Expected review result

- Phase 6 is complete after this branch is approved and merged.
- TypeScript and OpenAPI changes can reach an exact consumer and actionable
  Jest/Vitest recommendation or an explicit evidence-backed gap.
- Phase 7 can consume one deterministic Phase 6 result without reimplementing
  linkage or test-selection semantics.
