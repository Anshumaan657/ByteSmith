# Phase 6A–6C Review Checklist — Consumer Linkage

## Review scope

This combined branch delivers the consumer graph required before Jest and
Vitest intelligence can be added. Phases 6A, 6B, and 6C remain separately
reviewable below but are intended to be committed and merged once.

## Phase 6A — Direct TypeScript consumers

- [x] Consume Phase 4 canonical relationships instead of guessing from text.
- [x] Accept only authoritative call, reference, and resolved-import edges.
- [x] Match equivalent base/head symbols before selecting the traversal graph.
- [x] Prefer the head graph for existing contracts and safely fall back to the
  base graph for removed contracts.
- [x] Link only non-compatible contract changes.
- [x] Produce manifest-ready `typescript.direct-consumer` impacts.
- [x] Attach revision-owned evidence for every direct relationship.
- [x] Exclude unrelated symbols in the ChangeBench noise-control fixture.

## Phase 6B — Workspace and OpenAPI consumers

- [x] Resolve project ownership through authoritative workspace discovery.
- [x] Report cross-project consumers as workspace-package dependents only when
  both package owners are proven.
- [x] Recognize a narrow static OpenAPI client surface: `fetch`, `request`, and
  HTTP methods on explicitly named `api`, `client`, `http`, `axios`, or
  `openapi` objects.
- [x] Link route, method, inline-schema, and referenced component-schema changes
  to matching static client operations.
- [x] Exclude test files from consumer impacts; test linkage belongs to Phase
  6D–6F.
- [x] Emit source evidence for static client calls.
- [x] Preserve dynamic endpoints or methods as explicit possible unknowns.
- [x] Avoid network access and external-reference resolution.

## Phase 6C — Bounded transitive paths

- [x] Traverse reverse consumer edges in deterministic order.
- [x] Preserve complete ordered edge and evidence sequences.
- [x] Keep intermediate consumers visible as paths while reporting terminal
  affected consumers as impacts.
- [x] Deduplicate equivalent consumers across revisions.
- [x] Prevent cycles from creating unbounded traversal.
- [x] Enforce configurable maximum depth, consumer count, and edge count.
- [x] Convert every relevant limit truncation into a visible possible unknown.
- [x] Surface relevant unresolved-symbol and dynamic-import graph gaps.
- [x] Reject stale or cross-repository analysis inputs.
- [x] Produce stable result ordering and a deterministic semantic digest.

## Validation

- [x] Direct-consumer ChangeBench fixture reports only `checkoutTotal`.
- [x] Transitive-consumer ChangeBench fixture reports `renderProfile` with its
  complete two-edge path.
- [x] Unrelated-consumer ChangeBench fixture never reports
  `renderAdminDashboard`.
- [x] Cross-workspace fixture reports the dependent package.
- [x] Static OpenAPI fixture reports its exact calling function.
- [x] Repeated analysis produces identical semantic output.
- [x] Focused TypeScript compilation, tests, and lint pass.

## Full quality gate

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

## Expected review result

- Every reported consumer impact is backed by a complete authoritative or
  statically proven source path.
- Direct-consumer precision is 100% across the relevant MVP fixtures, above the
  roadmap’s 90% threshold.
- Unsupported or bounded work remains visible and cannot masquerade as complete
  analysis.
- Phases 6D, 6E, and 6F remain intentionally unimplemented.
