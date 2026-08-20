# ByteSmith Verify 0.1 Architecture

## Processing pipeline

```text
Git revisions
  -> normalized diff
  -> exhaustive changed-file inventory
  -> TypeScript/OpenAPI analyzers
  -> canonical local IR and evidence
  -> bounded consumer linkage
  -> Jest/Vitest recommendations and gaps
  -> validated Impact Manifest
  -> terminal/JSON/GitHub report
```

SQLite and the local filesystem are the only persistence mechanisms. The CLI
and GitHub Action run the same engine and must produce semantically identical
manifests for identical revisions and versions.

## Workspace responsibilities

| Workspace | Responsibility |
|---|---|
| `apps/cli` | Offline user commands, terminal output, JSON output, and stable exit codes |
| `apps/github-action` | Exact-head pull-request execution and one updating advisory report |
| `packages/impact-types` | Shared result, coverage, finding, lifecycle, and reference types |
| `packages/evidence` | Stable revision-bound evidence and provenance |
| `packages/ir` | Analyzer-neutral repository, contract, relationship, and test representation |
| `packages/canonicalization` | Normalization, stable IDs, ordering, and semantic digest |
| `packages/impact-manifest` | Canonical manifest construction and serialization |
| `packages/manifest-validator` | JSON Schema plus cross-field semantic validation |
| `packages/vcs-git` | Revision resolution, merge-base selection, and normalized Git diff |
| `packages/repository-inventory` | Full-diff denominator and exhaustive coverage classification |
| `packages/analyzer-sdk` | Analyzer capabilities, outcomes, failures, gaps, and unknown contracts |
| `packages/contracts-typescript` | Compiler API analysis and TypeScript/JavaScript contract rules |
| `packages/contracts-openapi` | High-value OpenAPI compatibility rules |
| `packages/consumer-analysis` | Direct and bounded transitive consumer paths with evidence |
| `packages/test-intelligence` | Jest/Vitest recommendations, reasons, commands, and test gaps |
| `packages/storage-sqlite` | Embedded local index and cache persistence |
| `packages/changebench` | Deterministic fixture execution, matching, metrics, and baselines |

## Dependency direction

Dependencies point toward stable domain packages:

```text
impact-types
  -> evidence / canonicalization
  -> ir / impact-manifest / manifest-validator
  -> vcs-git / repository-inventory / analyzer-sdk
  -> contracts-typescript / contracts-openapi
  -> consumer-analysis / test-intelligence
  -> storage-sqlite / changebench
  -> cli / github-action
```

The shared packages never import from either app. The GitHub Action is an
adapter over the same analysis engine used by the CLI; it does not implement a
second analyzer path.

## Safety boundaries

- Git inputs resolve to exact commits before analysis begins.
- Every changed path receives one coverage category.
- Required analyzer gaps derive `incomplete` or `error`, never `pass`.
- Evidence contains repository, revision, producer, source location, and stable
  identity.
- Consumer traversal is deterministic, bounded, and visibly truncated.
- Heuristics may rank test recommendations but cannot create authoritative
  contract or consumer evidence.
- “No test found” never claims that no test exists.
- Runtime timestamps and host-specific fields are excluded from the semantic
  digest.
- Reports are advisory in Verify 0.1 and never block a merge.

## Reproducibility

- Node.js is constrained to 22.13 or newer.
- pnpm is pinned to 11.19.0.
- TypeScript and repository tooling use exact dependency versions.
- The root TypeScript project references every active workspace.
- `scripts/validate-workspace.mjs` enforces the MVP directory map.
- `corepack pnpm check` runs workspace, schema, test, type, lint, and formatting
  validation locally and in CI.
