# ByteSmith Verify 0.1 — Phase-by-Phase MVP Implementation Roadmap

## Status and execution model

- Product target: ByteSmith Verify 0.1
- Team assumption: one full-time developer
- Delivery model: complete, review, commit, and merge one meaningful phase at a
  time
- Estimated full-time duration: approximately 4–6 months with controlled phase
  overlap
- Estimated part-time duration: approximately 8–12 months

No phase is complete merely because its code exists. Its exit gate, tests,
documentation, and evidence must also pass.

## Product objective

ByteSmith Verify must connect a changed TypeScript or OpenAPI contract to
affected consumers and relevant Jest or Vitest tests, then present deterministic
evidence locally and in a pull request.

## Schedule summary

| Phase | Outcome | Estimate | Depends on |
|---:|---|---:|---|
| 0 | Safety specifications and schema freeze | Complete | None |
| 1 | MVP scope and reproducible repository foundation | 1–2 weeks | Phase 0 |
| 2 | Deterministic 20-case ChangeBench suite | 2–3 weeks | Phase 1 |
| 3 | Git inventory, evidence, and canonical IR | 2–3 weeks | Phases 1–2 |
| 4 | TypeScript/JavaScript semantic analyzer | 5–7 weeks | Phase 3 |
| 5 | TypeScript and OpenAPI contract rules | 4–6 weeks | Phases 2–4 |
| 6 | Consumer linkage and Jest/Vitest intelligence | 4–6 weeks | Phases 4–5 |
| 7 | Impact Manifest, SQLite, and CLI | 3–4 weeks | Phases 3–6 |
| 8 | Advisory GitHub Action | 2–3 weeks | Phase 7 |
| 9 | Real-repository validation and Verify 0.1 release | 3–4 weeks | Phases 2–8 |

Phases 5–7 may overlap only where package contracts and ChangeBench expectations
are already frozen. Validation begins on real repositories before all interface
polish is complete.

# PHASE 0 — Safety Specifications and Schema Freeze

## Objective

Freeze ByteSmith’s safety semantics before production analysis is implemented.

## Included work

- Impact Manifest schema and shared impact types
- Result-state precedence
- Full-diff denominator
- Evidence and unknown-analysis models
- Rule lifecycle, appeal, waiver, and suspension data types
- ChangeBench case schema and exhaustive matching behavior
- Canonicalization and semantic digest
- Structural and cross-field semantic validation
- Scriptable lifecycle and determinism tests
- Architecture decision records

## Exit gate

- All schemas compile as Draft 2020-12.
- Required incomplete/error analysis cannot pass.
- Suspended rules and waivers remain visible and immutable.
- Unexpected benchmark output fails unless explicitly allowed.
- Identical semantic inputs produce identical digests.
- The complete Phase 0 validation suite passes.

## Status

Complete and merged.

# PHASE 1 — MVP Scope and Reproducible Repository Foundation

## Objective

Replace the industrial placeholder tree with the smallest buildable workspace
that supports Verify 0.1 without erasing deferred product intent.

## Deliverables

- Authoritative MVP scope, exclusions, architecture, and this roadmap
- Two active apps: CLI and GitHub Action
- Fifteen active internal packages with explicit responsibilities
- Removal of empty self-hosted, MCP, web, service-infrastructure, enterprise
  contract, cloud-storage, and framework-pack placeholders
- pnpm workspace pinned to pnpm 11.19.0
- Strict composite TypeScript projects on Node.js 22.13+
- ESLint and Prettier configuration
- Exact workspace-map validator and automated test
- Linux CI running the same aggregate check used locally
- README with MVP purpose, structure, prerequisites, and commands

## Exit gate

- A fresh clone installs with the frozen lockfile.
- All 17 workspaces build and type-check.
- No deferred implementation path exists in the active tree.
- Phase 0 validation still passes without semantic changes.
- Workspace, tests, lint, formatting, and CI commands pass.

# PHASE 2 — Deterministic ChangeBench MVP Suite

## Objective

Define correct positive, negative, failure, unsupported, consumer, and test
behavior before production analyzer rules are trusted.

## Required 20 cases

1. Safe internal implementation change
2. Exported function parameter removed
3. Required function parameter added
4. Optional parameter added
5. Exported return type changed
6. Interface field removed
7. Optional field made required
8. Package export removed
9. OpenAPI request field changed
10. OpenAPI response field removed
11. Direct consumer affected
12. One-level transitive consumer affected
13. Relevant Jest or Vitest test selected
14. Affected consumer without a test
15. Unrelated consumer forbidden
16. TypeScript path alias
17. Dynamic import reported as unknown
18. Unsupported file retained in the denominator
19. Required analyzer error cannot pass
20. Unexpected finding fails when `allowUnexpected` is false

## Deliverables

- Production ChangeBench runner promoted from the Phase 0 reference behavior
- Required and forbidden matching for changes, consumers, tests, and unknowns
- Unexpected-result accounting and useful mismatch diagnostics
- Deterministic fixture discovery and isolated temporary repositories
- Baseline/report format with precision, recall, unexpected, unsupported,
  incomplete, duration, and crash metrics
- Repeated-run semantic equality check

## Exit gate

- All 20 cases validate structurally and semantically.
- Every unexpected result is measured as a false positive when not allowed.
- No fixture depends on host-specific paths, time, network, or iteration order.
- Repeated runs produce identical semantic output.

# PHASE 3 — Git Inventory, Evidence, and Canonical IR

## Objective

Create a trustworthy, revision-bound input and representation layer shared by
every analyzer.

## Delivery slices

Phase 3 is delivered and reviewed through five independently merged slices:

1. **Phase 3A — Exact Git revisions and repository identity.** Repository
   discovery, immutable commit resolution, merge-base selection, working-tree
   inspection, and stale-reference checks.
2. **Phase 3B — Normalized Git diff.** Added, modified, deleted, renamed,
   copied, binary, and special-file representation.
3. **Phase 3C — Exhaustive repository inventory.** Exactly one coverage class
   and a visible reason for every changed path.
4. **Phase 3D — Revision-bound evidence and canonical IR.** Stable evidence,
   source locations, IDs, and analyzer-neutral records.
5. **Phase 3E — Deterministic integration.** End-to-end serialization,
   incremental/clean agreement, ChangeBench integration, and cross-platform
   verification.

Each slice must pass the repository quality gate and merge to `main` before the
next slice begins.

## Deliverables

- `--base` and `--head` revision resolution
- Merge-base resolution and exact commit binding
- Added, modified, deleted, and renamed file detection
- Binary-file detection
- Normalized paths and rename metadata
- Exhaustive changed-file denominator
- Exactly one category per changed file: analyzed, partially analyzed,
  unsupported, or intentionally excluded
- Visible ignored/generated/excluded reasons
- Repository identity and stale-head checks
- Stable evidence IDs, source locations, producer/version, and summaries
- Canonical IR for files, symbols, contracts, relationships, tests, and gaps
- Deterministic serialization and incremental/clean agreement tests

## Exit gate

- Git’s changed-path count equals the inventory denominator.
- No changed path silently disappears.
- Every IR object and evidence record is bound to exact revisions.
- Git errors and unsupported special files cannot produce clean success.
- Relevant ChangeBench cases pass on macOS and Linux.

## Phase 3 delivery status

- Phase 3A: complete and merged.
- Phase 3B: complete and merged.
- Phase 3C: complete and merged.
- Phase 3D: complete and merged.
- Phase 3E: complete and merged.

Phase 3E now connects exact Git resolution, normalized diff, exhaustive
inventory, revision-bound evidence, canonical IR, Impact Manifest construction,
Draft 2020-12 validation, semantic validation, canonical serialization, and
SHA-256 digest verification. Clean and exact-snapshot incremental executions
are required to agree semantically.

# PHASE 4 — TypeScript and JavaScript Semantic Analyzer

## Objective

Build the Compiler API engine that understands supported TypeScript and
JavaScript repositories without guessing about unsupported behavior.

## Delivery slices

Phase 4 is delivered and reviewed through five independently merged slices:

1. **Phase 4A — Project, workspace, and configuration discovery.** TypeScript
   and JavaScript configuration parsing, source membership, project references,
   npm/pnpm/Yarn workspaces, path aliases, and package boundaries.
2. **Phase 4B — Compiler host, parsing, and module resolution.** Revision-bound
   Compiler API programs, diagnostics, supported module resolution, and explicit
   unresolved-module gaps.
3. **Phase 4C — Symbols, exports, and public signatures.** Analyzer-neutral
   symbol and contract IR for supported declarations and public surfaces.
4. **Phase 4D — References, calls, and cross-revision identity.** Direct
   relationships plus safe matching of equivalent base/head symbols.
5. **Phase 4E — Deterministic analyzer integration.** Failure containment,
   resource limits, clean/incremental agreement, canonical manifest integration,
   performance fixtures, and relevant ChangeBench verification.

Each slice must pass the repository quality gate and merge to `main` before the
next slice begins.

## Phase 4 delivery status

- Phase 4A: complete and merged.
- Phase 4B: complete and merged.
- Phase 4C: complete and merged.
- Phase 4D: complete and merged.
- Phase 4E: complete and merged through pull request #13.

Phase 4E now exposes one bounded base/head analyzer entry point. It verifies
exact revision identities and immutable snapshot digests, runs compiler work in
a memory-bounded worker, terminates on timeout, projects all supported facts and
required gaps into canonical IR, and returns manifest-ready analyzer, evidence,
and unknown records. Exact validated incremental snapshots reuse prior semantic
output; stale or corrupted snapshots run clean. Runtime duration never changes
the canonical IR digest.

## Deliverables

- TypeScript project and `tsconfig.json` discovery
- JavaScript support through TypeScript project settings
- npm, pnpm, and Yarn workspace discovery
- Path aliases and project/package boundaries
- Imports, exports, re-exports, and package exports
- Functions, methods, interfaces, fields, type aliases, and classes
- Public signatures, parameters, optionality, and return types
- Direct calls and direct symbol references
- Stable symbol identity across base and head revisions
- Single-worker default with bounded memory
- Explicit unknowns for dynamic imports, reflection, complex dependency
  injection, generated code, unresolved modules, and type-checking failures
- Analyzer crash/timeout containment and required-outcome propagation

## Exit gate

- Supported fixtures produce deterministic symbol and relationship IR.
- Path aliases and basic monorepos resolve correctly.
- Unsupported patterns are visible unknowns, not guessed edges.
- Supported-fixture crash rate is zero.
- Small and medium benchmark repositories remain within MVP performance bounds.

# PHASE 5 — TypeScript and OpenAPI Contract Rules

## Objective

Detect the highest-value breaking contract changes for the only two contract
families included in Verify 0.1.

## Delivery slices

Phase 5 is divided into six reviewable slices. Phases 5D–5F are intentionally
delivered together on one branch because discovery, operation rules, schema
rules, and precision measurement form one inseparable OpenAPI execution path:

1. **Phase 5A — Shared contract-rule foundation.** Analyzer-neutral contract
   matching, versioned advisory rule registration, deterministic execution,
   evidence enforcement, manifest-ready changes, explicit ambiguity, and
   failure containment.
2. **Phase 5B — TypeScript callable rules.** Exported function and method
   removal plus parameter, optionality, overload, and return-type compatibility.
3. **Phase 5C — TypeScript structural and package rules.** Interfaces, fields,
   type aliases, class public surfaces, re-exports, and package exports.
4. **Phase 5D — OpenAPI discovery and canonical contracts.** JSON/YAML parsing,
   version detection, local references, operations, schemas, and explicit
   unsupported constructs.
5. **Phase 5E — OpenAPI route and operation rules.** Route, method, parameter,
   and request-body compatibility.
6. **Phase 5F — OpenAPI schema rules and Phase 5 integration.** Request and
   response fields, types, requiredness, enums, unified execution, and
   ChangeBench precision measurement.

Every delivered group must pass the repository quality gate before merge.

## Phase 5 delivery status

- Phase 5A: completed and merged through pull request #14.
- Phase 5B: completed and merged through pull request #16.
- Phase 5C: completed and merged through pull request #17.
- Phases 5D–5F: complete and merged together through pull request #18.

## TypeScript rules

- Exported function removed
- Exported required parameter removed or changed incompatibly
- Required parameter added
- Optional parameter added as a compatible change
- Exported return type changed incompatibly
- Exported interface or required field removed
- Optional interface field made required
- Exported type alias changed incompatibly
- Package export removed
- Evidence attached to the base/head declaration and rule version

Phase 5B delivers the callable subset through five versioned rules covering
exported callable identity, overloads, parameters, generic constraints, and
return/async contracts. Simple primitive, literal, and union relationships are
classified with direction-aware parameter and return variance. Complex types
or non-unique overload correspondence remain explicit required unknowns rather
than inferred breakages. The rules consume Phase 4 revision-bound contracts and
execute through the advisory-only Phase 5A registry.

Phase 5C delivers exported structural declarations, public fields, type aliases,
source-level re-exports, and package export-map entries through five additional
versioned rules. It preserves syntax evidence even when a re-export target is
unresolved, expands type-alias definitions canonically, distinguishes proven
primitive/union changes from complex structural unknowns, and keeps every
conclusion advisory and revision-bound.

## OpenAPI rules

- Route removed
- HTTP method removed
- Required parameter added
- Request field removed
- Response field removed
- Field type changed
- Optional field made required
- Enum value removed
- Explicit unsupported/ambiguous schema constructs

Phases 5D–5F discover repository-owned OpenAPI 3.0 and 3.1 JSON/YAML documents,
resolve local JSON Pointer references, and project operations plus component and
inline payload schemas into canonical IR. Nine versioned required rules cover
unsupported constructs, route and method removal, parameters, request bodies,
schema fields, types, requiredness, and enum contraction. External, unresolved,
recursive, composed, and otherwise unsupported schemas remain visible required
unknowns. The two OpenAPI ChangeBench contract fixtures produce exactly their
expected changes with 100% preliminary precision.

## Exit gate

- Every compatibility conclusion has deterministic evidence.
- Ambiguity becomes an unknown rather than a breaking guess.
- The relevant ChangeBench cases meet at least 95% preliminary contract-change
  precision.
- All rules remain advisory and ordinarily derive `warn`.

# PHASE 6 — Consumer Linkage and Test Intelligence

## Objective

Connect changed contracts to useful, bounded consumer paths and actionable Jest
or Vitest recommendations.

## Delivery slices

Phase 6 is divided into six reviewable slices. Phases 6A–6C are delivered
together because direct consumers, package/API linkage, and transitive traversal
share one evidence graph:

1. **Phase 6A — Direct TypeScript consumers.** Link non-compatible changes to
   authoritative import, reference, and call consumers across exact revisions.
2. **Phase 6B — Workspace and OpenAPI consumers.** Report cross-workspace
   package dependents and narrow, statically provable OpenAPI client calls.
3. **Phase 6C — Bounded transitive paths.** Traverse consumer relationships in
   deterministic order with cycle protection, deduplication, hard limits, and
   visible truncation.
4. **Phase 6D — Jest and Vitest discovery.** Discover test projects, frameworks,
   test files, and supported runnable commands.
5. **Phase 6E — Test recommendations and gaps.** Rank evidence-backed tests and
   report “no test found” without claiming absence.
6. **Phase 6F — Phase 6 integration.** Connect changes, terminal consumers, and
   tests, then measure precision, recall, determinism, and performance.

## Phase 6 delivery status

- Phase 6A: complete and merged through pull request #19.
- Phase 6B: complete and merged through pull request #19.
- Phase 6C: complete and merged through pull request #19.
- Phase 6D: complete and merged through pull request #20.
- Phase 6E: complete and merged through pull request #21.
- Phase 6F: implemented on the Phase 6F review branch; approval and merge
  pending.

## Consumer deliverables

- Direct import, reference, and call consumers
- Workspace package dependents
- Statically discoverable OpenAPI client references
- One or more bounded transitive paths
- Deterministic traversal order, deduplication, limits, and visible truncation
- Evidence for every edge in every reported path
- Explicit unknowns for unresolved or dynamic consumer relationships
- Relevance controls that do not remove files from coverage accounting

Phases 6A–6C consume Phase 4’s authoritative revision-bound graph instead of
re-parsing TypeScript heuristically. Existing symbols are matched across base
and head before traversal; removed contracts fall back to the base graph.
Terminal consumer impacts retain their complete shortest evidence paths while
intermediate nodes remain inspectable path records. Cross-project paths produce
workspace-package impacts when package ownership is proven. OpenAPI client
linkage recognizes a deliberately narrow static set of `fetch`, `request`, and
named HTTP-client calls; dynamic endpoints remain visible possible unknowns.

Phase 6D discovers Jest and Vitest projects from package manifests and static
configuration without executing repository code. It applies supported glob
patterns, finds exact test files and literal test names, derives package-manager
commands from repository-owned scripts, and projects revision-bound tests into
canonical IR. Dynamic configuration, regular-expression patterns, and dynamic
test names remain visible possible gaps. Phase 6E consumes this output without
changing Phase 6D discovery semantics.

Phase 6E connects discovered tests to Phase 6 consumer paths. Authoritative
call, reference, and import evidence outranks convention evidence; naming,
directory, and package conventions remain explicitly low confidence. A test
file that terminates a consumer path is folded back to the nearest non-test
consumer before ranking. Recommendations retain exact repository-owned
commands, deterministic scores, reasons, and evidence. Missing runnable
evidence produces the exact `not_found` wording “no test found”; Verify 0.1
never upgrades that result to `proven_absent`.

Phase 6F provides one deterministic integration result for TypeScript and
OpenAPI changes. It validates exact-revision bindings, joins contract changes,
bounded consumer paths, discovered tests, recommendations, gaps, unknowns, and
their referenced evidence, and excludes runtime measurements from the semantic
digest. A terminal test-file consumer is normalized to the nearest non-test
consumer before the final result is built. ChangeBench-backed quality metrics
enforce at least 90% direct-consumer precision, at least 80% test-selection
recall, identical semantic digests across repeated runs, forbidden unrelated
results, evidence closure, and a bounded development-runtime check.

## Test deliverables

- Jest and Vitest project/test discovery
- Direct test imports of affected modules
- Tests referencing affected consumers
- Naming and directory conventions as labeled low-confidence evidence
- Ranked recommendations with exact runnable commands and reasons
- Test gaps for affected consumers where no test was found
- Required wording: “no test found,” never “no test exists”
- No coverage ingestion, Playwright, historical failures, automatic generation,
  selective skipping, or automatic execution

## Exit gate

- Every reported consumer path resolves to source evidence.
- Unrelated consumers are forbidden by benchmark cases.
- Direct-consumer precision is at least 90% on the MVP evaluation set.
- Test-selection recall is at least 80% on the MVP evaluation set.
- Every recommendation and gap explains its evidence and limitations.

# PHASE 7 — Impact Manifest, SQLite, and CLI

## Objective

Turn the analysis engine into a complete offline developer workflow.

## Manifest deliverables

- Schema and engine versions
- Repository identity plus exact base/head revisions
- Final result status
- Complete changed-file scope and analyzer outcomes
- Evidence, contract changes, affected consumers, recommended tests, test gaps,
  unknowns, and semantic digest
- Canonical JSON serialization and semantic validation

## Storage deliverables

- SQLite schema and migrations
- Local filesystem manifest/report output
- Revision/version-scoped cache keys
- Corruption detection and safe cache invalidation
- No PostgreSQL, network service, or cloud dependency

## CLI commands

- `bytesmith init`
- `bytesmith doctor`
- `bytesmith analyze --base <ref> --head <ref>`
- `bytesmith contracts`
- `bytesmith test-plan`
- `bytesmith verify-impact`
- `bytesmith benchmark`

## CLI behavior

- Terminal and JSON formats
- `--output impact.json`
- Stable documented exit codes
- Color/no-color and accessible plain text
- Clear unsupported, partial, incomplete, and error explanations
- Offline execution without account, cloud, or AI key

## Exit gate

- A fresh supported repository completes the local workflow without assistance.
- Terminal and JSON reports represent the same canonical manifest.
- `doctor` identifies missing Git, Node, project, and analyzer prerequisites.
- Manifest verification rejects stale, corrupt, or semantically invalid results.
- All commands have automated success and failure tests.

# PHASE 8 — Advisory GitHub Action

## Objective

Run the same ByteSmith engine in pull requests and present one stable advisory
report.

## Deliverables

- GitHub Action metadata and bundled runtime
- Full-history checkout requirements
- Pull-request base/head resolution
- Exact analyzed-head binding and stale-result refusal
- One updating report instead of duplicate comments
- Breaking contract changes, consumers, recommended tests, test gaps, unknowns,
  coverage, and evidence links
- Analyzer failure mapped to `incomplete` or `error`
- Fork, permission, cancellation, rebase, and force-push handling
- Local/CI semantic digest parity
- Explicitly non-blocking Verify 0.1 behavior

## Exit gate

- Re-running the same head updates rather than duplicates the report.
- A changed head cannot reuse or publish stale findings.
- Required analyzer failure never appears as a successful clean analysis.
- Local and GitHub runs produce semantically identical manifests.
- The action never blocks a merge in Verify 0.1.

# PHASE 9 — Real-Repository Validation and Verify 0.1 Release

## Objective

Measure whether the connected verification workflow is accurate, useful,
understandable, and fast enough to validate the product hypothesis.

## Repository portfolio

- One ordinary TypeScript repository
- One monorepo
- One API/backend repository
- One repository using OpenAPI
- One older or inconsistent repository

## Deliverables

- Historical and live advisory evaluations
- Every material discrepancy minimized into ChangeBench when possible
- Contract precision, consumer precision, test recall, unsupported, incomplete,
  crash, determinism, duration, and memory reports
- Performance tuning for one-worker M1 defaults
- Installation and troubleshooting documentation
- Known-limitations and supported-pattern documentation
- Five-developer usability evaluation without author assistance
- Package and GitHub Action release process
- Versioned Verify 0.1 release notes

## Release gate

- All changed files remain accounted for.
- Required failures never pass.
- Every conclusion has resolvable evidence.
- Contract precision is at least 95%.
- Direct-consumer precision is at least 90%.
- Test-selection recall is at least 80%.
- Determinism is 100% for identical inputs and versions.
- Supported-fixture analyzer crash rate is zero.
- Small pull requests run in less than 30 seconds on the target M1 Air.
- Medium pull requests run in less than 2 minutes.
- Peak memory is preferably below 3 GB.
- Five developers complete the workflow without assistance and identify at least
  one useful affected consumer or test.

## Verify 0.1 definition of done

A developer can open a TypeScript pull request and automatically understand:

- what contract changed;
- who consumes it;
- which tests should run;
- which affected code has no test ByteSmith found;
- what ByteSmith could not analyze; and
- the evidence for every conclusion.

No deferred enterprise or platform capability is required to declare the MVP
complete.

## Requirement traceability

| MVP requirement | Owning phase |
|---|---:|
| Safety schemas, states, evidence, unknowns, lifecycle, digest | 0 |
| MVP-only repository and reproducible CI | 1 |
| 20 high-value benchmark cases and metrics | 2 |
| Git revisions, merge-base, changed-file denominator, evidence, IR | 3 |
| TypeScript/JavaScript semantic model and unsupported patterns | 4 |
| TypeScript and OpenAPI compatibility rules | 5 |
| Consumer paths, Jest/Vitest recommendations, test gaps | 6 |
| Manifest, SQLite, terminal/JSON CLI, stable exits | 7 |
| One exact-head advisory GitHub report | 8 |
| Accuracy, performance, usability, five repository types, release | 9 |
