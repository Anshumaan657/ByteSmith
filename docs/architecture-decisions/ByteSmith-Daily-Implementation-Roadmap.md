# ByteSmith — Complete Phase-by-Phase Daily Implementation Roadmap

## Status and planning assumptions

- **Product direction:** Frozen.
- **Final review verdict:** Ready after the four mandatory Phase 0 corrections are implemented and tested.
- **Current deployment scope from the accepted roadmap:** CLI, GitHub Action, and Self-Hosted; the MCP verification interface is also implemented as Phase 10.
- **Deferred unless triggered by real customer demand:** ByteSmith Cloud, COBOL/mainframe, cross-repository intelligence, runtime telemetry, and additional languages.
- **Schedule basis:** One experienced full-time developer, five focused engineering days per week. A “day” means one meaningful deliverable, including its tests and documentation—not merely coding time.
- **Baseline active roadmap:** 385 workdays / 77 workweeks / about 17.7 calendar months if executed sequentially.
- **Practical calendar range:** 14–20 months solo. The 17.7-month baseline assumes normal progress; analyzer accuracy, design-partner access, security findings, or platform hardening can move it within the range.
- **Team estimate:** Three to four experienced engineers can parallelize the work to about 7–11 months, depending on analyzer accuracy and timely design-partner access.
- **No deadline may bypass correctness, safety, or blocking-graduation gates.**
- **How to use this document:** Copy it into the project tracker and mark each `P<phase>-D<day>` checkbox complete only after its stated tests, evidence, and done condition pass.

## Final product vision

> **ByteSmith is a local-first verification engine that connects changed contracts to affected consumers and required tests, then produces reproducible, appealable, and auditable evidence before merge.**

Primary tagline:

> **Prove the impact before you merge.**

Core workflow:

```text
Changed contract
      ↓
Compatibility classification
      ↓
Affected consumers
      ↓
Relevant and missing tests
      ↓
Unknown and unsupported analysis paths
      ↓
Versioned Impact Manifest
```

ByteSmith is not primarily a code graph, repository chatbot, AI coding agent, API-diff utility, or legacy-modernization product. The graph and optional AI are supporting technologies; the product is the connected verification result.

## Non-negotiable engineering principles

1. The denominator is every file touched by the normalized diff.
2. Unsupported, ignored, generated, and intentionally excluded files remain visible.
3. Measured scope coverage is never described as unknowable real-world completeness.
4. `error` and `incomplete` never collapse into `pass`.
5. Suspended enforcement never makes a finding disappear.
6. Every authoritative conclusion has deterministic evidence and provenance.
7. Original findings are immutable.
8. Identical inputs and versions produce identical normalized semantic output.
9. AI may explain evidence but cannot create authoritative evidence or set status.
10. Blocking is rule-specific, evidence-based, and explicitly enabled.
11. CLI, GitHub Action, MCP server, and Self-Hosted use one shared kernel.
12. Core use requires no cloud service, account, or paid AI key.

## Mandatory Phase 0 corrections

### Correction 1 — Suspended rules remain visible

- A suspended rule cannot block a merge.
- Existing findings remain visible.
- If safe advisory execution is possible, emit new findings as `warn` with `ruleState: suspended` and the suspension reason.
- If execution is unsafe, return policy result `not_evaluated` and emit an explicit analysis gap or unknown; produce at least `warn`, and `incomplete` when the rule/analyzer is required.
- A suspended rule can never turn an otherwise visible problem into a clean `pass`.
- Repository, organization, and global suspension remain distinct scopes.
- Represent and test this behavior in `result-states.md`, policy evaluation, manifest schema, ChangeBench, CLI output, and GitHub reports.

### Correction 2 — Waiver scopes are explicit

- `finding`: one immutable finding in one manifest.
- `pull_request`: equivalent occurrences across later revisions of the same pull request.
- `repository`: equivalent findings matching an authorized selector in one repository.
- `organization`: equivalent findings matching an authorized selector across an organization; elevated authorization is mandatory.
- Every waiver includes `findingId`, reason, actor, creation time, status, and explicit scope.
- `pull_request` requires pull-request identity.
- `repository` requires repository identity plus rule/subject selector.
- `organization` requires organization identity, selector, and elevated approval.
- Scope never defaults silently.
- A waiver never deletes or modifies the original finding.
- An active waiver yields at least `warn`, never `pass`.

### Correction 3 — ChangeBench requires `allowUnexpected`

- `allowUnexpected` is required in `changebench-case.schema.json` and documented beside assertion groups.
- `allowUnexpected: false` makes every unmatched change, impact, test, or unknown a benchmark failure unless another matcher explicitly allows it.
- `allowUnexpected: true` is allowed only when the fixture explains why exhaustive matching is impossible.
- Blocking-rule fixtures normally use `false`.
- When `false`, unexpected results count as false positives in the benchmark report.

### Correction 4 — Appeal and waiver graduation is scriptable

- Automatically create, adjudicate, and move at least one appeal to a terminal outcome with an audit record.
- Appeal outcomes: `upheld` (finding was wrong and regression work is required), `rejected` (finding remains valid), and `superseded` (later analysis/rule version replaced it).
- Automatically create a temporary waiver, activate it, expire or revoke it, re-evaluate, and prove the underlying finding becomes active again when still applicable.
- Both workflows must pass automated end-to-end tests.

## Planned monorepo structure

```text
bytesmith/
├── apps/
│   ├── cli/
│   ├── github-action/
│   ├── mcp-server/
│   ├── self-hosted-api/
│   ├── worker/
│   └── web/
├── packages/
│   ├── impact-types/
│   ├── impact-manifest/
│   ├── manifest-validator/
│   ├── canonicalization/
│   ├── changebench/
│   ├── vcs-git/
│   ├── repository-inventory/
│   ├── analyzer-sdk/
│   ├── framework-pack-sdk/
│   ├── ir/
│   ├── graph/
│   ├── evidence/
│   ├── rule-engine/
│   ├── policy-engine/
│   ├── consumer-analysis/
│   ├── test-intelligence/
│   ├── storage-sqlite/
│   ├── storage-postgres/
│   ├── artifacts-local/
│   ├── artifacts-s3/
│   ├── contracts-typescript/
│   ├── contracts-openapi/
│   ├── contracts-graphql/
│   ├── contracts-prisma/
│   ├── contracts-events/
│   ├── pack-nextjs/
│   ├── pack-nestjs/
│   ├── pack-jest/
│   ├── pack-vitest/
│   └── pack-playwright/
├── changebench/
│   ├── fixtures/
│   ├── reports/
│   └── baselines/
├── schemas/
├── specs/
├── infra/
│   ├── compose/
│   ├── helm/
│   └── observability/
├── docs/
│   ├── compatibility/
│   ├── security/
│   ├── operations/
│   └── architecture-decisions/
└── scripts/
```

Dependencies point inward toward stable domain packages. Interface packages may depend on the shared kernel; the kernel must never depend on CLI, GitHub, MCP, or web presentation packages. The physical skeleton may begin during Phase 0, but public APIs and module boundaries cannot freeze until the manifest and benchmark schemas are approved.

## Phase schedule summary

| Phase | Outcome | Planned solo work | Dependency |
|---|---|---:|---|
| 0 | Corrected normative schemas frozen | 15 days / 3 weeks | None |
| 1 | Reproducible repository foundation | 10 days / 2 weeks | Phase 0 semantics |
| 2 | Deterministic ChangeBench with 34+ cases | 20 days / 4 weeks | Phase 0 |
| 3 | Git diff, inventory, evidence, and IR | 25 days / 5 weeks | Phases 1–2 |
| 4 | Production TypeScript analyzer and first-party packs | 40 days / 8 weeks | Phase 3 |
| 5 | Multi-contract compatibility engine | 40 days / 8 weeks | Phase 4 |
| 6 | Consumer graph, impact engine, and manifest | 30 days / 6 weeks | Phases 4–5 |
| 7 | Evidence-based test intelligence | 25 days / 5 weeks | Phase 6 |
| 8 | Local-first ByteSmith CLI | 20 days / 4 weeks | Phases 3–7 |
| 9 | Advisory-first GitHub Action | 20 days / 4 weeks | Phase 8 |
| 10 | Safe MCP verification interface | 15 days / 3 weeks | Phase 8 |
| 11 | Real design-partner validation | 40 days / 8 weeks, partly parallel | Phases 8–10 |
| 12 | Production Self-Hosted platform | 50 days / 10 weeks | Stable kernel + partner feedback |
| 13 | Industrial hardening and 1.0 | 35 days / 7 weeks | Phases 9–12 |
| **Total** | **Complete active industrial roadmap** | **385 days / 77 weeks / ~17.7 months** | — |

---

# PHASE 0 — Normative Specifications and Schema Freeze

**Duration:** 15 workdays (3 weeks)
**Objective:** Turn accepted product rules into machine-readable contracts before implementation choices make them expensive to change.

## Daily execution plan

- [ ] **P0-D01 — Product invariants:** Write `product-invariants.md`; define the full-diff denominator, visible exclusions, deterministic evidence, immutable findings, local-first behavior, shared-kernel constraint, and AI boundaries. Done when each invariant has a testable statement.
- [ ] **P0-D02 — Result-state model:** Write `result-states.md`; define `pass`, `warn`, `fail`, `incomplete`, and `error`, plus required/non-required analyzer behavior. Encode the rule that `error` and `incomplete` never become `pass`.
- [ ] **P0-D03 — Suspended-rule semantics:** Add repository-, organization-, and global-suspension scopes; safe advisory execution; unsafe `not_evaluated`; visible findings; warning/incomplete consequences; and suspension reasons.
- [ ] **P0-D04 — Core vocabularies:** Define evidence, component, change, impact, test, unknown, policy, suspension, and analyzer-result vocabularies with stable IDs and version fields.
- [ ] **P0-D05 — Waiver vocabulary:** Define `finding`, `pull_request`, `repository`, and `organization` scopes; required conditional identities/selectors/approval; actor, reason, status, creation time; immutable original findings; and `warn` minimum.
- [ ] **P0-D06 — Appeal vocabulary:** Define appeal creation, adjudication, audit records, state transitions, and terminal outcomes `upheld`, `rejected`, and `superseded`.
- [ ] **P0-D07 — Impact Manifest specification:** Write `impact-manifest.md` covering revisions, engine/analyzer/rule versions, changes, impacts, tests, unknowns, gaps, policies, appeals, waivers, suspensions, coverage, evidence, and final status.
- [ ] **P0-D08 — JSON Schema foundation:** Implement Draft 2020-12 shared schemas for IDs, evidence, locations, components, versions, and results; establish schema versioning and references.
- [ ] **P0-D09 — Manifest schema:** Implement the Impact Manifest JSON Schema including suspended rule state, `not_evaluated`, analysis gaps, explicit waiver scopes, appeals, and status fields.
- [ ] **P0-D10 — ChangeBench schema/spec:** Write `changebench.md` and `changebench-case.schema.json`; place required `allowUnexpected` beside assertion groups and define required/forbidden changes, impacts, tests, and unknowns.
- [ ] **P0-D11 — Graduation specification:** Write `rule-graduation.md`; include objective thresholds and automated appeal/temporary-waiver lifecycle requirements.
- [ ] **P0-D12 — Canonicalization and digest:** Define field ordering, set/list semantics, normalized paths, nondeterministic-field removal, stable IDs, semantic digests, schema versions, and byte/semantic comparison rules.
- [ ] **P0-D13 — Validation prototype:** Implement schema validation plus cross-field semantic validation for conditional waiver fields, revision binding, evidence references, rule state, and status consistency.
- [ ] **P0-D14 — Scriptable lifecycle tests:** Automate an appeal from creation to terminal outcome with audit record; automate waiver creation, activation, expiry/revocation, re-evaluation, and finding reactivation.
- [ ] **P0-D15 — Freeze review and ADRs:** Validate every schema against Draft 2020-12, run semantic and lifecycle tests, record an ADR for each frozen decision, resolve every conclusion-changing question, then version and freeze the schemas.

## Normative status derivation order

1. Required analyzer `error` → `error`.
2. Required analyzer `incomplete` → `incomplete`.
3. Enabled, non-suspended, non-waived blocking violation → `fail`.
4. Suspended-rule finding, active waiver, advisory finding, non-required analyzer gap, or policy warning → `warn`.
5. Otherwise → `pass`.

If a suspended rule is unsafe to evaluate, `not_evaluated` plus an explicit gap prevents clean success.

## Phase 0 exit gate

- All JSON schemas validate against Draft 2020-12.
- Cross-field semantic validation is specified and tested.
- Suspended findings cannot disappear.
- Waiver scopes are enumerated and conditionally validated.
- `allowUnexpected` is required.
- Appeal and waiver lifecycle gates are objectively testable.
- No unresolved semantic question can change a manifest conclusion.

---

# PHASE 1 — Repository and Engineering Foundation

**Duration:** 10 workdays (2 weeks)
**Objective:** Create a maintainable, reproducible development platform without prematurely freezing unstable domain APIs.

## Daily execution plan

- [ ] **P1-D01 — Workspace skeleton:** Create the strict TypeScript pnpm monorepo, apps/packages/folders shown above, project references, inward dependency rules, and placeholder package boundaries without declaring unstable APIs public.
- [ ] **P1-D02 — Runtime reproducibility:** Select and pin active-LTS Node.js and pnpm versions; add lockfile policy, toolchain checks, and documented bootstrap commands.
- [ ] **P1-D03 — Strict TypeScript:** Enable strict compiler settings, consistent module/target rules, build graphs, declaration generation rules, and boundary checks.
- [ ] **P1-D04 — Code quality:** Add formatter, linter, unit-test framework, integration-test harness, and coverage collection with one local command.
- [ ] **P1-D05 — CI matrix:** Add public GitHub Actions where appropriate; test supported Node versions and macOS, Linux, and Windows behavior.
- [ ] **P1-D06 — Release discipline:** Add changesets/versioning, conventional or structured commits, tagged reproducible releases, changelog generation, and artifact provenance.
- [ ] **P1-D07 — Supply-chain baseline:** Add dependency-update automation, secret scanning, dependency scanning, SBOM generation, and license checks.
- [ ] **P1-D08 — Compatibility rules:** Document supported Node and Git versions, path/case-sensitivity behavior, schema/package compatibility, and generate the compatibility matrix.
- [ ] **P1-D09 — Architecture guardrails:** Add ADR templates; enforce that production modules use shared manifest types and that the kernel cannot import CLI, Action, MCP, or web layers.
- [ ] **P1-D10 — Clean-checkout proof:** Run bootstrap/build/lint/unit/integration/coverage on a fresh checkout across the CI matrix; reproduce a release from a tag and fix all discrepancies.

## Phase 1 exit gate

- A clean checkout builds and tests with one documented command.
- CI runs on every supported operating system.
- Releases reproduce from a tagged commit.
- No production module bypasses shared manifest types.

---

# PHASE 2 — ChangeBench Foundation

**Duration:** 20 workdays (4 weeks)
**Objective:** Define correct positive, negative, failure, unsupported, suspension, and waiver behavior before building the analyzer.

## Daily execution plan

- [ ] **P2-D01 — Runner skeleton:** Build fixture discovery, schema validation, immutable before/after snapshot materialization, and isolated execution.
- [ ] **P2-D02 — Matcher engine:** Support required and forbidden changes, impacts, tests, and unknowns; include precise diagnostics for missing and forbidden results.
- [ ] **P2-D03 — Unexpected-result enforcement:** Implement required `allowUnexpected`; make unmatched results fail and count as false positives when `false`; require an explanation when `true`.
- [ ] **P2-D04 — Deterministic normalization:** Normalize clocks, durations, temporary paths, ordering, random IDs, and environment fields; add repeated-run equality checks.
- [ ] **P2-D05 — Metrics:** Compute precision, recall, F1, test-selection recall, unsupported rate, incomplete rate, and determinism rate per rule and framework pack, not only globally.
- [ ] **P2-D06 — Fixtures 1–2:** Add safe internal implementation change and exported function parameter added.
- [ ] **P2-D07 — Fixtures 3–4:** Add exported parameter removed and required parameter introduced.
- [ ] **P2-D08 — Fixtures 5–6:** Add optional parameter introduced and exported return type changed.
- [ ] **P2-D09 — Fixtures 7–8:** Add interface field removed and optional interface field made required.
- [ ] **P2-D10 — Fixtures 9–10:** Add package export removed and OpenAPI request change.
- [ ] **P2-D11 — Fixtures 11–12:** Add OpenAPI response field removed and GraphQL field removed.
- [ ] **P2-D12 — Fixtures 13–14:** Add GraphQL argument made required and Prisma column removed.
- [ ] **P2-D13 — Fixtures 15–16:** Add Prisma nullability changed and event field removed.
- [ ] **P2-D14 — Fixtures 17–18:** Add event field made required and direct consumer affected.
- [ ] **P2-D15 — Fixtures 19–20:** Add transitive consumer affected and unrelated consumer forbidden.
- [ ] **P2-D16 — Fixtures 21–23:** Add unit test selected, integration test selected, and affected behavior without a test.
- [ ] **P2-D17 — Fixtures 24–26:** Add dynamic import surfaced as unknown, TypeScript path alias, and circular dependency.
- [ ] **P2-D18 — Fixtures 27–30:** Add generated file visibly classified, ignored file retained in denominator, unsupported file retained in denominator, and required analyzer crash cannot pass.
- [ ] **P2-D19 — Fixtures 31–34:** Add suspended rule still surfaces warning, expired waiver reactivates finding, repository suspension does not become global, and `allowUnexpected: false` fails on an unlabeled result.
- [ ] **P2-D20 — Benchmark audit:** Ensure every fixture has negative expectations or a documented reason, blocking candidates normally use `allowUnexpected: false`, run multiple deterministic repetitions, publish the first baseline report, and fix all harness instability.

## Phase 2 exit gate

- All fixture schemas validate.
- The suite contains at least all 34 listed fixtures.
- Every fixture has negative expectations or a documented reason.
- Unsupported-file and suspended-rule fixtures pass.
- Benchmark output is deterministic across repeated runs.

---

# PHASE 3 — Git Diff, Repository Inventory, Evidence, and Canonical IR

**Duration:** 25 workdays (5 weeks)
**Objective:** Build the trustworthy input, coverage, evidence, and representation foundation shared by every analyzer.

## Daily execution plan

- [ ] **P3-D01 — Git adapter contract:** Define immutable base/head/merge-base inputs, repository identity, normalized diff records, error states, and adapter conformance tests.
- [ ] **P3-D02 — Revision resolution:** Resolve base, head, and merge base for local branches, commits, detached HEAD, and CI-provided revisions.
- [ ] **P3-D03 — Core change kinds:** Implement and test additions, modifications, and deletions.
- [ ] **P3-D04 — Structural change kinds:** Implement and test renames, copies, and file type changes with similarity metadata.
- [ ] **P3-D05 — Special paths:** Detect binary files, submodules, symlinks, and Git LFS pointers without pretending to parse them.
- [ ] **P3-D06 — Immutable binding:** Bind analysis and evidence to exact revisions and repository identity; reject ambiguous or missing revisions.
- [ ] **P3-D07 — Stale-result protection:** Recheck head before publication and refuse to publish when the analyzed head changed.
- [ ] **P3-D08 — Full-diff inventory:** Enumerate every changed path before analyzer filtering and prove counts match source-control truth.
- [ ] **P3-D09 — Coverage taxonomy:** Assign exactly one coverage class to every changed path and define exhaustive enum semantics.
- [ ] **P3-D10 — Visible exclusions:** Record reasons and applicable analyzer IDs; keep ignored, generated, intentionally excluded, and unsupported files in the denominator.
- [ ] **P3-D11 — Inventory validation:** Reject duplicate/missing classifications; generate coverage totals and cross-check them against the normalized diff.
- [ ] **P3-D12 — Evidence schema implementation:** Implement stable evidence IDs, repository/revision, source location, producer/version, kind, and human-readable summary.
- [ ] **P3-D13 — Evidence resolution:** Build revision-pinned source links and tests proving each link resolves to the correct file and location.
- [ ] **P3-D14 — Provenance chain:** Connect evidence to analyzers, rules, inputs, versions, and resulting conclusions without mutable backreferences.
- [ ] **P3-D15 — IR foundations:** Represent repositories, files, modules, packages, and symbols uniformly.
- [ ] **P3-D16 — Contract IR:** Add contracts, APIs, events, database entities, and configuration representations.
- [ ] **P3-D17 — Service/test IR:** Add services and tests plus typed relationships between all IR nodes.
- [ ] **P3-D18 — Stable identity rules:** Define canonical node IDs, path normalization, revision scoping, and content-derived identity where safe.
- [ ] **P3-D19 — IR serialization:** Add versioned deterministic serialization, validation, and canonicalization.
- [ ] **P3-D20 — Incremental inventory:** Add content hashing and changed-node invalidation without losing full-diff visibility.
- [ ] **P3-D21 — Full/incremental parity:** Run clean full analysis and incremental analysis over identical histories and compare inventories.
- [ ] **P3-D22 — Platform path tests:** Test path separators, Unicode, case sensitivity, file modes, and symlink behavior on supported systems.
- [ ] **P3-D23 — Failure/unknown behavior:** Ensure Git failures, unsupported special files, and unresolved source locations surface explicitly and cannot produce clean success.
- [ ] **P3-D24 — ChangeBench integration:** Feed normalized diffs, coverage inventory, evidence, and IR into relevant fixtures and record metrics.
- [ ] **P3-D25 — Foundation audit:** Verify exact source-control counts, one bucket per path, revision-correct evidence links, stale-result rejection, and clean/incremental agreement.

## Phase 3 exit gate

- Full-diff counts exactly match source-control truth.
- Every changed path belongs to exactly one coverage bucket.
- Evidence links resolve at the analyzed revision.
- Clean full and incremental inventories agree.

---

# PHASE 4 — Production-Grade TypeScript Analyzer

**Duration:** 40 workdays (8 weeks)
**Objective:** Deliver deep semantic TypeScript understanding using the TypeScript Compiler API or a carefully controlled wrapper, not shallow Tree-sitter pattern matching.

## Daily execution plan

- [ ] **P4-D01 — Analyzer contract:** Define analyzer lifecycle, typed inputs/outputs, capability metadata, failure states, deterministic ordering, and analyzer SDK boundaries.
- [ ] **P4-D02 — Compiler host:** Create revision-bound TypeScript compiler hosts for in-memory snapshots while preserving original source locations.
- [ ] **P4-D03 — Project discovery:** Locate `tsconfig` files, source roots, include/exclude patterns, and standalone TypeScript/JavaScript entry points.
- [ ] **P4-D04 — Config inheritance:** Resolve `extends`, inherited options, composite builds, and invalid/missing configuration as explicit gaps.
- [ ] **P4-D05 — Project references:** Build and validate the project-reference graph, including cycles and partial projects.
- [ ] **P4-D06 — Workspace discovery:** Resolve npm, pnpm, yarn, and generic workspace package boundaries and ownership.
- [ ] **P4-D07 — Module resolution:** Implement Node/TypeScript module resolution with package boundaries and deterministic resolution evidence.
- [ ] **P4-D08 — Path aliases:** Resolve `baseUrl`, `paths`, aliases, and workspace imports; complete the path-alias fixture.
- [ ] **P4-D09 — Export maps:** Resolve `package.json` exports/imports maps, conditional exports, entry points, and removed package exports.
- [ ] **P4-D10 — Declaration files:** Load authored/generated `.d.ts` files, distinguish their provenance, and preserve generated-file visibility.
- [ ] **P4-D11 — Symbol extraction:** Extract modules, namespaces, symbols, declarations, and source ranges into canonical IR.
- [ ] **P4-D12 — Import/export extraction:** Extract imports, re-exports, default/named exports, type-only edges, and dynamic imports.
- [ ] **P4-D13 — Signature extraction:** Extract functions, methods, constructors, parameters, optionality, overloads, and return types.
- [ ] **P4-D14 — Type extraction:** Extract aliases, interfaces, object shapes, unions/intersections, literals, enums, nullability, and accessibility.
- [ ] **P4-D15 — Reference extraction:** Extract symbol references and distinguish type-space and value-space uses.
- [ ] **P4-D16 — Call extraction:** Extract direct calls, constructor calls, callbacks where resolvable, and unresolved/dynamic call sites.
- [ ] **P4-D17 — Object relationships:** Extract inheritance, interface implementation, overrides, and structural conformance evidence.
- [ ] **P4-D18 — Decorators:** Extract decorators and metadata required by first-party framework packs.
- [ ] **P4-D19 — Generic constraints:** Extract type parameters, constraints, defaults, instantiations, and unresolved generic relationships.
- [ ] **P4-D20 — Stable symbol IDs:** Design IDs resilient to ordinary file moves when semantic identity is sufficiently certain; otherwise version and surface identity changes.
- [ ] **P4-D21 — Partial compilation:** Preserve safe syntactic analysis when type checking fails; separate authoritative semantic facts from syntactic candidates.
- [ ] **P4-D22 — Unknown behavior:** Report unresolved types, dynamic imports/calls, reflective access, unsupported syntax, and ambiguous resolution explicitly.
- [ ] **P4-D23 — Crash/timeouts:** Isolate analyzer crashes/timeouts, emit `error`/`incomplete` correctly, and prove required failures never pass.
- [ ] **P4-D24 — Content cache:** Implement content-addressed parser/program artifacts with versioned cache keys.
- [ ] **P4-D25 — Incremental invalidation:** Add symbol-level invalidation for changed source, configuration, package metadata, and dependencies.
- [ ] **P4-D26 — Full/incremental parity:** Compare normalized semantic output from clean and incremental runs across representative histories.
- [ ] **P4-D27 — Circular dependencies:** Detect and safely traverse cycles without duplicate/unbounded results; complete the circular-dependency fixture.
- [ ] **P4-D28 — Next.js pack discovery:** Implement file-system routing, route handlers, layouts/pages, and framework ownership.
- [ ] **P4-D29 — Next.js server actions:** Identify server actions and their consumers with deterministic or clearly heuristic evidence.
- [ ] **P4-D30 — Express pack:** Extract routers, routes, middleware, handlers, mounts, and unresolved dynamic routing.
- [ ] **P4-D31 — NestJS controllers:** Extract controller decorators, routes, parameters, DTO contracts, and handler relationships.
- [ ] **P4-D32 — NestJS DI:** Extract modules, providers, injections, scopes, and unresolved dependency-injection edges.
- [ ] **P4-D33 — Prisma pack foundation:** Discover schemas, generated clients, model usages, and migration relationships while keeping generated content visible.
- [ ] **P4-D34 — Jest pack:** Discover configuration, projects, suites, tests, imports, hooks, and runnable test commands.
- [ ] **P4-D35 — Vitest pack:** Discover configuration, workspaces, suites, tests, imports, hooks, and runnable commands.
- [ ] **P4-D36 — Playwright pack:** Discover configuration, projects, specs, tests, route/API use, fixtures, and runnable commands.
- [ ] **P4-D37 — Pack SDK:** Formalize first-party framework-pack capability/version contracts, evidence requirements, unknown reporting, and deterministic output.
- [ ] **P4-D38 — Benchmark accuracy:** Run all TypeScript/framework ChangeBench cases, classify every false positive/negative, and add regression cases.
- [ ] **P4-D39 — Performance/incremental pass:** Profile representative repositories, improve caching/invalidation, and enforce an initial analyzer performance budget in CI.
- [ ] **P4-D40 — Analyzer release gate:** Publish advisory TypeScript metrics and limitations; verify unknowns, crash safety, partial compilation, stable evidence, and full/incremental parity.

The Next.js, Express, NestJS, Prisma, Jest, Vitest, and Playwright packs are first-party. Do not market them as a community ecosystem until external maintainers exist.

## Phase 4 exit gate

- TypeScript ChangeBench cases meet the current advisory thresholds.
- Unsupported TypeScript patterns appear as unknowns.
- Analyzer crashes and partial compilation never pass silently.
- Incremental and full normalized semantic outputs agree.

---

# PHASE 5 — Contract Compatibility Engine

**Duration:** 40 workdays (8 weeks)
**Objective:** Detect meaningful compatibility changes across the first supported contract types using versioned, evidence-backed rules.

## Rule contract required for every rule

- Stable rule ID and version.
- Supported contract type and contract versions.
- Compatibility classification.
- Confidence requirements.
- Deterministic evidence requirements.
- Known limitations.
- Default advisory/blocking-eligibility state.
- Positive and negative ChangeBench cases.

## Daily execution plan

- [ ] **P5-D01 — Compatibility model:** Define compatibility classes, directionality, severity, confidence, evidence, ambiguity, advisory state, and version semantics.
- [ ] **P5-D02 — Rule SDK/registry:** Implement stable IDs/versions, supported-version declarations, capability negotiation, known-limitations metadata, and deterministic evaluation order.
- [ ] **P5-D03 — TypeScript exported functions:** Compare exported function/method signatures and detect added/removed parameters.
- [ ] **P5-D04 — TypeScript parameter semantics:** Classify required versus optional parameter changes, defaults, rest parameters, and overload effects.
- [ ] **P5-D05 — TypeScript returns:** Compare exported return types, promises, unions, nullability, and covariance-sensitive changes.
- [ ] **P5-D06 — TypeScript shapes:** Compare exported interfaces/type aliases, removed fields, required/optional transitions, readonly changes, and nested shapes.
- [ ] **P5-D07 — TypeScript exports:** Detect removed/renamed exports, entry-point changes, and package export-map changes.
- [ ] **P5-D08 — TypeScript advanced types:** Handle generics, constraints, enums, overload sets, inheritance, and ambiguous structural compatibility as `unknown`.
- [ ] **P5-D09 — TypeScript benchmark:** Complete fixtures and publish per-rule precision/recall/limitations without enabling blocking.
- [ ] **P5-D10 — OpenAPI ingestion:** Parse supported OpenAPI versions, references, paths, operations, parameters, requests, responses, and schemas.
- [ ] **P5-D11 — OpenAPI routes/parameters:** Detect route/operation removal and parameter location, requiredness, type, and constraint changes.
- [ ] **P5-D12 — OpenAPI requests:** Compare request bodies, content types, required properties, validation constraints, and schema composition.
- [ ] **P5-D13 — OpenAPI responses:** Compare status codes, content types, removed response fields, nullability, and schema changes.
- [ ] **P5-D14 — OpenAPI references/unknowns:** Resolve local/external references within policy; surface unresolved/cyclic/unsupported constructs as unknown.
- [ ] **P5-D15 — OpenAPI benchmark:** Add positive/negative cases, publish rule metrics and known limitations, remain advisory.
- [ ] **P5-D16 — GraphQL ingestion:** Parse supported SDL/schema forms and represent object/interface/input/enum/scalar/union contracts.
- [ ] **P5-D17 — GraphQL field rules:** Detect removed fields, changed return types, list/nullability transitions, and interface effects.
- [ ] **P5-D18 — GraphQL argument rules:** Detect removed arguments, newly required arguments, defaults, type/nullability, and directive changes.
- [ ] **P5-D19 — GraphQL inputs/enums:** Compare input fields, requiredness, enum values, unions, interfaces, and custom scalar ambiguity.
- [ ] **P5-D20 — GraphQL benchmark:** Add positive/negative cases, publish per-rule metrics/limitations, remain advisory.
- [ ] **P5-D21 — Prisma ingestion:** Parse supported Prisma schemas, models, fields, relations, indexes, defaults, database mappings, and datasource metadata.
- [ ] **P5-D22 — Prisma columns:** Detect removed/renamed columns, type changes, native-type changes, and database mapping changes.
- [ ] **P5-D23 — Prisma nullability/defaults:** Compare optional/required transitions, defaults, generated values, uniqueness, and index constraints.
- [ ] **P5-D24 — Prisma relationships:** Compare relation cardinality, keys, referential actions, and unresolved relation ambiguity.
- [ ] **P5-D25 — Prisma migrations:** Connect migration operations to schema changes and distinguish destructive/potentially breaking changes.
- [ ] **P5-D26 — Prisma benchmark:** Add positive/negative cases, publish per-rule metrics/limitations, remain advisory.
- [ ] **P5-D27 — Event contract ingestion:** Define supported event envelope/schema formats and extract event names, versions, producers, consumers, and payloads.
- [ ] **P5-D28 — Event names/versions:** Detect removed/renamed events and incompatible version/routing changes.
- [ ] **P5-D29 — Event payload rules:** Detect removed fields, newly required fields, type/nullability changes, and schema ambiguity.
- [ ] **P5-D30 — Event benchmark:** Add positive/negative cases, publish per-rule metrics/limitations, remain advisory.
- [ ] **P5-D31 — Environment variables:** Discover declared/used variables and classify removed, renamed, newly required, defaulted, and secret-sensitive changes.
- [ ] **P5-D32 — Configuration keys:** Compare supported typed/schema-backed configuration contracts and surface convention-only ambiguity.
- [ ] **P5-D33 — Package exports:** Compare package entry points, conditions, types, subpaths, and consumer-visible removals across supported package formats.
- [ ] **P5-D34 — Config/export benchmark:** Add positive/negative/unknown cases and publish metrics/limitations.
- [ ] **P5-D35 — Unified comparison engine:** Normalize all contract changes into shared change IR while preserving contract-specific evidence and rule versions.
- [ ] **P5-D36 — Ambiguity policy:** Audit every fallback; replace guesses with explicit `unknown`, confidence, limitations, and evidence gaps.
- [ ] **P5-D37 — Determinism pass:** Repeat every rule over identical versions/inputs and compare canonical results/digests.
- [ ] **P5-D38 — Failure and suspension integration:** Exercise required analyzer failures, non-required gaps, suspended rules, waivers, and policy outcomes across contract types.
- [ ] **P5-D39 — Per-rule publication:** Generate compatibility matrices and precision/recall/F1/unsupported/incomplete/determinism reports separately for every rule.
- [ ] **P5-D40 — Compatibility release gate:** Review evidence, known limitations, versions, fixtures, and metrics; keep all rules advisory unless they later pass the independent graduation gate.

## Phase 5 exit gate

- Every compatibility conclusion has deterministic evidence.
- Ambiguity becomes `unknown`, never an unsupported guess.
- Metrics are published separately per rule.
- No rule becomes blocking simply because this phase is complete.

---

# PHASE 6 — Consumer Graph and Impact Engine

**Duration:** 30 workdays (6 weeks)
**Objective:** Connect changed contracts to affected components without unbounded noise and produce the canonical Impact Manifest.

## Daily execution plan

- [ ] **P6-D01 — Graph model:** Define versioned node/edge types, direction, confidence, producer, evidence, temporal validity, and deterministic IDs.
- [ ] **P6-D02 — Graph construction:** Convert TypeScript/framework/contract IR relationships into graph nodes and evidence-backed edges.
- [ ] **P6-D03 — Forward traversal:** Implement bounded deterministic producer-to-consumer traversal with path evidence.
- [ ] **P6-D04 — Reverse traversal:** Implement bounded deterministic consumer/source tracing for impact explanation and test discovery.
- [ ] **P6-D05 — Direct impacts:** Identify and evidence direct consumers of changed contracts.
- [ ] **P6-D06 — Transitive impacts:** Identify supported transitive consumers and retain the path connecting each to the source change.
- [ ] **P6-D07 — Impact taxonomy:** Distinguish direct, transitive, contract, policy, test-gap, and heuristic impacts.
- [ ] **P6-D08 — Evidence ranking:** Rank direct deterministic evidence above indirect or heuristic evidence without hiding lower-confidence paths.
- [ ] **P6-D09 — Traversal controls:** Add configurable depth/node/time limits; emit visible truncation and affected frontier details.
- [ ] **P6-D10 — Path deduplication:** Deduplicate equivalent paths/findings using canonical semantics while preserving materially different evidence.
- [ ] **P6-D11 — Noise controls:** Define scoped filters and relevance ranking without removing paths from coverage/unknown accounting.
- [ ] **P6-D12 — Unresolved consumers:** Surface dynamic/unresolved consumer relationships as explicit unknowns and analysis gaps.
- [ ] **P6-D13 — Temporal graph:** Track relationship creation/removal/change across revisions and analyzer versions.
- [ ] **P6-D14 — SQLite schema:** Implement local adjacency storage, migrations, transactions, indexes, and deterministic retrieval.
- [ ] **P6-D15 — SQLite lifecycle:** Add rebuild/incremental update, corruption handling, locking, and revision-aware cache invalidation.
- [ ] **P6-D16 — PostgreSQL design:** Define compatible graph persistence, migrations, tenant/repository/revision keys, and query contracts for Self-Hosted.
- [ ] **P6-D17 — Manifest serializer:** Serialize revisions, inventory, changes, impacts, tests, unknowns, policies, evidence, versions, and coverage using Phase 0 schemas.
- [ ] **P6-D18 — Canonicalizer:** Implement normative sorting, normalization, ignored runtime fields, stable identity, and semantic comparison.
- [ ] **P6-D19 — Digest/validator:** Implement semantic digest plus schema/cross-field/reference validation with actionable errors.
- [ ] **P6-D20 — Result-state derivation:** Implement the exact `error` → `incomplete` → `fail` → `warn` → `pass` precedence.
- [ ] **P6-D21 — Suspended rules:** Implement safe advisory warnings, unsafe `not_evaluated` gaps, distinct suspension scopes, and visible existing findings.
- [ ] **P6-D22 — Waivers:** Apply explicit scoped waivers without modifying original findings; active waivers yield at least `warn`.
- [ ] **P6-D23 — Appeals/audit hooks:** Preserve finding immutability, appeal references, outcomes, and audit-ready events without allowing appeals to mutate evidence.
- [ ] **P6-D24 — User-facing hierarchy:** Order results as breaking/potential contracts, direct consumers, transitive consumers, required tests, missing tests, unknowns/gaps, then expandable evidence paths; keep visual graph secondary.
- [ ] **P6-D25 — Noise benchmarks:** Run direct/transitive/unrelated consumer fixtures and count unexpected impacts as false positives.
- [ ] **P6-D26 — Truncation benchmarks:** Test limits, cycles, large fan-out, unresolved consumers, and deterministic frontier reporting.
- [ ] **P6-D27 — Manifest reproducibility:** Repeat runs and compare normalized output/digests across full and incremental analysis.
- [ ] **P6-D28 — Storage parity:** Compare in-memory, SQLite, and PostgreSQL-contract query semantics on identical graphs.
- [ ] **P6-D29 — Failure injection:** Test corrupt caches, storage failures, missing evidence, suspended evaluation failure, stale revisions, and incomplete required analysis.
- [ ] **P6-D30 — Impact release gate:** Verify every impact traces to a source change/evidence path, noise is measured, truncation is visible, and identical input creates the same manifest.

## Phase 6 exit gate

- Every impact points to a source change and evidence path.
- ChangeBench measures unexpected impact noise.
- Traversal truncation and unresolved consumers remain visible.
- Identical inputs produce identical normalized manifests.

---

# PHASE 7 — Test Intelligence

**Duration:** 25 workdays (5 weeks)
**Objective:** Convert impact analysis into an evidence-backed, actionable verification plan.

## Daily execution plan

- [ ] **P7-D01 — Test IR and capability model:** Define test suites/cases/projects, evidence kinds, runnable commands, analysis completeness, and adequacy semantics.
- [ ] **P7-D02 — Jest discovery:** Connect Jest configs/projects/suites/tests to repository components and exact commands.
- [ ] **P7-D03 — Vitest discovery:** Connect Vitest configs/workspaces/suites/tests to repository components and exact commands.
- [ ] **P7-D04 — Playwright discovery:** Connect Playwright configs/projects/specs/tests to routes, APIs, and user-facing behavior.
- [ ] **P7-D05 — Import linkage:** Map tests to components/contracts through deterministic module imports and re-exports.
- [ ] **P7-D06 — Call/reference linkage:** Use resolved calls and references to strengthen test-to-behavior relationships.
- [ ] **P7-D07 — Route linkage:** Connect integration/end-to-end tests through routes, controllers, server actions, and API clients.
- [ ] **P7-D08 — Configuration linkage:** Account for setup files, fixtures, project selection, tags, environments, and test dependencies.
- [ ] **P7-D09 — Coverage ingestion foundation:** Support standard coverage formats, validate provenance/revision, and normalize file/source mappings.
- [ ] **P7-D10 — Coverage linkage:** Connect covered locations/functions/branches to graph nodes without treating coverage as proof of assertion quality.
- [ ] **P7-D11 — Selection engine:** Rank recommended unit, integration, and end-to-end tests using deterministic evidence before heuristics.
- [ ] **P7-D12 — Exact commands:** Produce platform-safe, workspace-aware commands for recommended tests and projects.
- [ ] **P7-D13 — Missing-test detection:** Identify affected components with no adequate test evidence and attach the reason/path.
- [ ] **P7-D14 — Absence language:** Distinguish “no test found” from “test proven absent”; never overclaim completeness.
- [ ] **P7-D15 — Unknown/incomplete behavior:** Surface unsupported runners, stale/missing coverage, dynamic linkage, and partial discovery; incomplete analysis cannot claim success.
- [ ] **P7-D16 — Historical failures:** Ingest available test outcomes and connect failure history to tests, revisions, and affected areas.
- [ ] **P7-D17 — Recall evaluation:** Compare recommendations against full-suite historical results and calculate test-selection recall.
- [ ] **P7-D18 — Benchmark mode:** Run recommendation logic only in benchmarks; collect false selections/omissions and refine evidence.
- [ ] **P7-D19 — Shadow mode:** Produce non-user-facing shadow selections beside full suites and compare outcomes.
- [ ] **P7-D20 — Advisory mode:** Expose recommendations/reasons while retaining normal full-suite execution.
- [ ] **P7-D21 — Recommended-first mode:** Run recommended tests first, then the full suite; measure time to first relevant failure and missed failures.
- [ ] **P7-D22 — Selective-skip safety plan:** Document the separate evidence program required before skipping any tests; do not require or enable selective skipping for the current release.
- [ ] **P7-D23 — Fixture completion:** Pass unit/integration selection, affected-without-test, unresolved behavior, and incomplete-analysis cases with negative expectations.
- [ ] **P7-D24 — Performance/determinism:** Optimize discovery/linkage, repeat analysis, and verify stable normalized recommendations and exact commands.
- [ ] **P7-D25 — Test-intelligence gate:** Publish recall and limitations; verify evidence/reasons, careful missing-test wording, and safe incomplete behavior.

## Safety progression

1. Benchmark mode.
2. Shadow mode.
3. Advisory recommendations.
4. Recommended tests first, then the full suite.
5. Selective skipping only after a separate evidence program; it is not required for the current release.

## Phase 7 exit gate

- Every recommendation includes reasons and evidence.
- Missing-test findings distinguish “no test found” from “test proven absent.”
- Incomplete test analysis never produces a success claim.

---

# PHASE 8 — ByteSmith CLI

**Duration:** 20 workdays (4 weeks)
**Objective:** Deliver immediate local value without accounts, cloud services, databases, or AI keys.

## Required command surface

```text
bytesmith init
bytesmith doctor
bytesmith scan
bytesmith contracts
bytesmith impact --base <revision>
bytesmith test-plan --base <revision>
bytesmith context --base <revision>
bytesmith verify-impact <manifest>
bytesmith benchmark
```

## Daily execution plan

- [ ] **P8-D01 — CLI architecture:** Define command framework, shared-kernel adapter, config resolution, revision inputs, cancellation, logging, and no-network default.
- [ ] **P8-D02 — Versioned configuration:** Implement config schema/versioning, discovery/precedence, validation, safe defaults, and migration-ready diagnostics.
- [ ] **P8-D03 — `bytesmith init`:** Generate minimal configuration, preserve existing files, explain selected defaults, and remain useful with zero configuration.
- [ ] **P8-D04 — `bytesmith doctor`:** Check Node/Git/toolchain, repository state, configs, analyzers, framework packs, schemas, storage, permissions, and offline readiness.
- [ ] **P8-D05 — `bytesmith scan`:** Run repository discovery/inventory/analyzers and produce a general verification report.
- [ ] **P8-D06 — `bytesmith contracts`:** Show changed contracts, compatibility classification, rule/version, evidence, limitations, and unknowns.
- [ ] **P8-D07 — `bytesmith impact`:** Analyze against `--base`, show direct/transitive consumers, gaps, traversal limits, and revision binding.
- [ ] **P8-D08 — `bytesmith test-plan`:** Show recommended tests, exact commands, reasons/evidence, missing tests, and completeness limits.
- [ ] **P8-D09 — `bytesmith context`:** Produce a compact agent/developer context view tied to base/head, engine version, and manifest digest.
- [ ] **P8-D10 — `bytesmith verify-impact`:** Validate schema, semantic references, canonicalization/digest, versions, revision expectations, and policy-result consistency.
- [ ] **P8-D11 — `bytesmith benchmark`:** Run selected/all ChangeBench fixtures, repeat determinism checks, compare baselines, and emit per-rule/pack metrics.
- [ ] **P8-D12 — Human terminal output:** Implement the result hierarchy, readable evidence paths, remediation, documentation links, color/no-color, Unicode-safe and accessible plain text.
- [ ] **P8-D13 — JSON output:** Emit the canonical JSON Impact Manifest exactly matching the shared schema and kernel result.
- [ ] **P8-D14 — SARIF output:** Map applicable findings/evidence/levels without losing ByteSmith states or pretending gaps are ordinary pass results.
- [ ] **P8-D15 — CI summary:** Add compact deterministic output, annotations where safe, artifact paths, and machine-consumable summaries.
- [ ] **P8-D16 — Exit-code contract:** Define stable codes for pass, warn, fail, incomplete, error, invalid configuration, and unsupported schema version; ensure shell adapters do not treat warn/incomplete as process crashes.
- [ ] **P8-D17 — Offline/privacy proof:** Test with outbound network disabled; confirm analysis uses local SQLite/filesystem and no source leaves the machine.
- [ ] **P8-D18 — Cross-platform packaging:** Build/install/test on supported macOS, Linux, Windows, Node, Git, path, case, TTY, and non-TTY combinations.
- [ ] **P8-D19 — Performance/usability:** Enforce startup and analysis budgets in CI; test a fresh TypeScript repository and refine zero-config explanations/remediation.
- [ ] **P8-D20 — CLI release gate:** From a clean install, run one command, validate/reproduce the manifest, test every exit state and output format, and publish compatibility/limitations docs.

## Phase 8 exit gate

- One command gives a useful report in a fresh TypeScript repository.
- The local manifest validates and reproduces.
- No source code leaves the machine.

---

# PHASE 9 — GitHub Action

**Duration:** 20 workdays (4 weeks)
**Objective:** Bring identical local verification into pull requests using repository-owner compute and begin advisory-only.

## Daily execution plan

- [ ] **P9-D01 — Action contract:** Define inputs/outputs, permission model, exact revision binding, shared-kernel invocation, artifacts, check mapping, and advisory default.
- [ ] **P9-D02 — Secure packaging:** Build a pinned/reproducible Action distribution, minimize permissions, generate SBOM/provenance, and document pinning.
- [ ] **P9-D03 — PR revision resolution:** Correctly resolve base, head, merge base, forks, merge queues, detached refs, and shallow histories.
- [ ] **P9-D04 — Exact binding:** Attach every result to exact PR/base/head identities and prevent results from one revision satisfying another.
- [ ] **P9-D05 — Push/rebase/force-push handling:** Cancel or supersede obsolete work and recompute against the current head.
- [ ] **P9-D06 — Event deduplication:** Make runs idempotent across duplicate events/retries and avoid duplicate analyses/artifacts.
- [ ] **P9-D07 — Cancellation/stale prevention:** Handle concurrency cancellation and perform a final head check before publishing.
- [ ] **P9-D08 — Single-report updates:** Create/update one Check Run or report rather than spamming comments; preserve stable anchors and history links.
- [ ] **P9-D09 — Report hierarchy:** Publish status, changed contracts, direct/transitive consumers, required/missing tests, gaps/unknowns, coverage, and expandable evidence.
- [ ] **P9-D10 — Result-state mapping:** Preserve pass/warn/fail/incomplete/error semantics in GitHub conclusions and summaries without mapping incomplete analysis to success.
- [ ] **P9-D11 — Appeal workflow entry:** Add safe links or commands to create an appeal tied to immutable finding, manifest, PR, actor, and audit data.
- [ ] **P9-D12 — Waiver workflow entry:** Add safe links or commands for explicit-scope temporary waivers, authorization requirements, visibility, and audit data.
- [ ] **P9-D13 — Policy bundle/opt-in:** Permit blocking only for `blocking_eligible` rules explicitly enabled by repository or approved policy bundle; remain advisory by default.
- [ ] **P9-D14 — Suspension behavior:** Keep suspended findings visible as warning or unsafe `not_evaluated` gaps; distinguish repository/organization/global scopes.
- [ ] **P9-D15 — Emergency disable:** Implement visible, scoped, authorized, audited emergency disabling that cannot erase existing findings.
- [ ] **P9-D16 — Input integrity:** Validate Action/webhook-derived inputs where applicable and treat repository content as untrusted data.
- [ ] **P9-D17 — Failure injection:** Crash/timeout a required analyzer, corrupt partial outputs, change head mid-run, and prove no path publishes `pass` or accepts stale results.
- [ ] **P9-D18 — Appeal E2E:** Create an appeal, adjudicate it to `upheld`, `rejected`, or `superseded`, persist an audit record, and verify report updates.
- [ ] **P9-D19 — Waiver E2E:** Create/activate a temporary waiver, expire or revoke it, re-evaluate the same applicable finding, and prove it becomes active again.
- [ ] **P9-D20 — Action release gate:** Test push/rebase/force-push/duplicate/cancel/fork flows, one-report updates, result mapping, suspension visibility, and advisory-only release docs.

## Phase 9 exit gate

- Failure injection proves a required analyzer failure cannot pass.
- Expired/revoked waiver behavior passes end to end.
- At least one appeal and one waiver complete their full audited lifecycles.

---

# PHASE 10 — MCP Verification Interface

**Duration:** 15 workdays (3 weeks)
**Objective:** Make ByteSmith usable by any coding agent without becoming a general agent or allowing AI to control authoritative outcomes.

## Initial tool surface

- `analyze_current_change`
- `get_changed_contracts`
- `get_affected_consumers`
- `get_recommended_tests`
- `get_missing_tests`
- `get_evidence_path`
- `get_analysis_unknowns`

## Daily execution plan

- [ ] **P10-D01 — MCP boundary/security design:** Define local and Self-Hosted transports, tool schemas, authorization, repository scope, untrusted-content handling, and read-only verification posture.
- [ ] **P10-D02 — Shared response envelope:** Include exact manifest revision, base/head, manifest digest, engine/analyzer/rule versions, status, completeness, and evidence references in every response.
- [ ] **P10-D03 — `analyze_current_change`:** Run or retrieve revision-bound analysis and return the canonical summary without letting the model alter evidence/status.
- [ ] **P10-D04 — `get_changed_contracts`:** Return versioned compatibility results, evidence, limitations, and unknowns with pagination/size controls.
- [ ] **P10-D05 — `get_affected_consumers`:** Return direct/transitive impacts, paths, confidence, truncation, and unresolved consumers.
- [ ] **P10-D06 — `get_recommended_tests`:** Return exact commands, reasons, evidence, selection state, and completeness limits.
- [ ] **P10-D07 — `get_missing_tests`:** Return evidence-backed gaps using careful “not found” versus “proven absent” language.
- [ ] **P10-D08 — `get_evidence_path`:** Resolve a finding/impact/test to revision-bound source evidence without arbitrary repository queries.
- [ ] **P10-D09 — `get_analysis_unknowns`:** Return unsupported files, dynamic behavior, analyzer gaps, truncation, suspension `not_evaluated`, and required-analysis state.
- [ ] **P10-D10 — Prohibited capabilities:** Enforce no unrestricted database query, no arbitrary command execution, no policy/status/waiver/evidence mutation, and no hidden source forwarding.
- [ ] **P10-D11 — Untrusted data defenses:** Mark repository content as untrusted tool data, constrain sizes, redact secrets, validate paths, and resist instruction injection in source/comments.
- [ ] **P10-D12 — Local mode:** Run fully offline against local manifests/kernel/storage and prove source is not sent to a model by ByteSmith.
- [ ] **P10-D13 — Self-Hosted mode contract:** Define authenticated remote manifest/evidence retrieval with tenant/repository/revision scoping for later platform implementation.
- [ ] **P10-D14 — Client integration:** Test with Codex, Claude, or another MCP client consuming impacts and acting on recommended tests without ByteSmith itself sending source to a model.
- [ ] **P10-D15 — MCP release gate:** Run schema/security/compatibility tests, verify version/revision propagation, publish tool docs and limitations, and confirm AI summaries cannot mutate authority.

## Phase 10 exit gate

- An MCP client can consume an impact result and act on recommended tests.
- ByteSmith does not send source code to a model itself.
- No tool permits arbitrary commands, unrestricted database access, or authoritative-result mutation.

---

# PHASE 11 — Design-Partner Evaluation

**Duration:** 40 workdays (8 focused weeks), partly parallel with Phases 9–10 and early Phase 12
**Objective:** Prove ByteSmith works on real, messy repositories, not only controlled fixtures.

## Required partner portfolio

Obtain three to five unrelated TypeScript codebases that collectively cover:

- pnpm/Nx/Turborepo monorepo.
- Next.js application.
- NestJS or Express backend.
- Prisma/PostgreSQL application.
- Event-driven or multi-package application.
- Older inconsistent repository.

The combined repositories must include dynamic imports, path aliases, circular dependencies, dependency injection, generated code, incomplete tests, unusual layouts, shared internal packages, database migrations, and real pull-request history.

## Daily execution plan

- [ ] **P11-D01 — Evaluation protocol:** Freeze consent/privacy/data-handling rules, repository/revision sampling, metrics, feedback rubric, appeal/override capture, and anonymized publication policy.
- [ ] **P11-D02 — Partner sourcing:** Identify 3–5 unrelated candidates matching the portfolio; confirm authorization, compute ownership, and access to historical PRs.
- [ ] **P11-D03 — Onboarding package:** Create install/run/offline instructions, known limitations, support channel, incident path, and reproducible data-collection scripts.
- [ ] **P11-D04 — Baseline capture:** Record repository size/type, frameworks, test systems, dynamic patterns, full-suite behavior, and current developer workflow.
- [ ] **P11-D05 — Historical sample design:** Select representative safe/breaking/noisy/failing PRs without cherry-picking only supported cases.
- [ ] **P11-D06 — Partner 1 offline setup:** Run local historical analysis; fix configuration/discovery issues without hiding unsupported paths.
- [ ] **P11-D07 — Partner 1 historical evaluation:** Compare contracts, impacts, tests, unknowns, and status to code/review/test truth.
- [ ] **P11-D08 — Partner 1 shadow analysis:** Run on current PRs without affecting decisions; capture latency, stale runs, failures, and noise.
- [ ] **P11-D09 — Partner 1 advisory/usefulness:** Present reports, collect time-to-understand/action-change feedback, appeals, overrides, and missing evidence.
- [ ] **P11-D10 — Partner 1 regressions:** Convert every material discrepancy into minimized ChangeBench fixtures or document why minimization is impossible.
- [ ] **P11-D11 — Partner 2 offline setup:** Repeat authorized setup and preserve all unsupported/ignored/generated coverage.
- [ ] **P11-D12 — Partner 2 historical evaluation:** Compare against PR history and full-suite outcomes.
- [ ] **P11-D13 — Partner 2 shadow analysis:** Run silently on live revisions and measure reliability/latency/noise.
- [ ] **P11-D14 — Partner 2 advisory/usefulness:** Gather human feedback, appeals, overrides, and action changes.
- [ ] **P11-D15 — Partner 2 regressions:** Add discrepancies and unusual layouts/dynamic cases to ChangeBench.
- [ ] **P11-D16 — Partner 3 offline setup:** Repeat setup in a materially different repository class.
- [ ] **P11-D17 — Partner 3 historical evaluation:** Compare analysis to historical evidence and failures.
- [ ] **P11-D18 — Partner 3 shadow analysis:** Measure behavior on live changes.
- [ ] **P11-D19 — Partner 3 advisory/usefulness:** Collect qualitative/quantitative feedback, appeals, and overrides.
- [ ] **P11-D20 — Partner 3 regressions:** Add every material discrepancy as a regression fixture.
- [ ] **P11-D21 — Partner 4 setup/evaluation:** If available, evaluate the missing framework/repository class, prioritizing older inconsistent layouts.
- [ ] **P11-D22 — Partner 4 shadow/advisory:** Collect live behavior, feedback, appeals, and regressions.
- [ ] **P11-D23 — Partner 5 setup/evaluation:** If available, fill the final event-driven/multi-package/monorepo coverage gap.
- [ ] **P11-D24 — Partner 5 shadow/advisory:** Collect live behavior, feedback, appeals, and regressions.
- [ ] **P11-D25 — Cross-partner accuracy:** Segment precision, recall, F1, unexpected, unsupported, incomplete, evidence-resolution, and determinism by rule/version/repository type.
- [ ] **P11-D26 — Test usefulness:** Measure relevant-test recall, accepted missing-test findings, time to first relevant failure, and full-suite comparisons.
- [ ] **P11-D27 — Developer usefulness:** Measure accepted/appealed/waived/suppressed findings, findings per PR, time to understand, action changes, repeat usage, and Action retention.
- [ ] **P11-D28 — Operational health:** Measure latency percentiles, crashes/timeouts, stale reports, resource use, and any queue behavior by repository class.
- [ ] **P11-D29 — False-positive review:** Investigate all high-severity false positives and every unexplained unexpected result; correct rules or narrow eligibility.
- [ ] **P11-D30 — False-negative review:** Search historical full-suite/review data for missed incompatibilities/consumers/tests; correct rules and add regression fixtures.
- [ ] **P11-D31 — Local/CI parity:** Compare semantic manifests/digests across partner local and GitHub runs on identical revisions.
- [ ] **P11-D32 — Failure-state proof:** Inject supported crashes/timeouts/stale revisions and confirm safe result states in partner-like environments.
- [ ] **P11-D33 — Appeal lifecycle proof:** Complete a real or controlled appeal through terminal adjudication and audit record.
- [ ] **P11-D34 — Waiver lifecycle proof:** Complete temporary waiver activation, expiry/revocation, re-evaluation, and finding reactivation.
- [ ] **P11-D35 — Adversarial review:** If no natural discrepancy appeared, commission/perform independent adversarial evaluation rather than assuming perfection.
- [ ] **P11-D36 — Version stability:** Compare candidate rules across three released analyzer versions where enough history exists; do not backfill stability claims dishonestly.
- [ ] **P11-D37 — 200-finding audit:** For any blocking candidate, verify at least 200 real advisory findings across at least three unrelated repositories.
- [ ] **P11-D38 — Latest-100 audit:** Verify no unresolved high-severity false positive exists in the latest 100 findings for each candidate.
- [ ] **P11-D39 — Graduation review:** Evaluate every condition independently and leave non-qualifying rules advisory-only.
- [ ] **P11-D40 — Partner report:** Publish honest segmented metrics, known limitations, regression outcomes, usefulness findings, and rule-by-rule eligibility decisions.

## Blocking graduation gate for each rule version

A rule version is `blocking_eligible` only when every condition is true:

- Precision is at least 99% for its rule class.
- Recall is at least 95%.
- Behavior is stable across three released analyzer versions.
- At least 200 real advisory findings exist.
- Evidence comes from at least three unrelated partner repositories.
- No unresolved high-severity false positive exists in the latest 100 findings.
- Every blocking result has complete deterministic evidence.
- Local and CI semantic output is equal.
- Failure states are proven safe.
- The repository explicitly opts in.
- Emergency disable is audited.
- One appeal was created and adjudicated to a terminal state.
- One temporary waiver completed activation, expiry/revocation, and re-evaluation.
- A real discrepancy became a regression fixture, or independent adversarial evaluation was completed.

No customer request or schedule can bypass this gate.

---

# PHASE 12 — Self-Hosted Platform

**Duration:** 50 workdays (10 weeks)
**Objective:** Provide persistent team and organization value without ByteSmith Cloud.

## Required platform services

- API/control plane.
- Analysis orchestrator.
- Isolated workers.
- PostgreSQL.
- NATS JetStream.
- Optional Valkey.
- Local/S3-compatible artifact storage.
- Web dashboard.
- OpenTelemetry-based observability.

## Daily execution plan

- [ ] **P12-D01 — Platform architecture/threat model:** Define trust boundaries, tenant/repository/revision identity, data flows, isolation, services, failure domains, and shared-kernel use.
- [ ] **P12-D02 — Deployment topology:** Define single-node and scalable topologies, required/optional services, ports, storage, resource assumptions, and air-gap constraints.
- [ ] **P12-D03 — PostgreSQL foundation:** Implement migrations and schemas for organizations, users, teams, repositories, revisions, manifests, findings, policies, and audit events.
- [ ] **P12-D04 — Graph persistence:** Implement the PostgreSQL-compatible graph schema and repository/revision/tenant-scoped adjacency operations from Phase 6.
- [ ] **P12-D05 — Temporal history:** Persist immutable manifests and analyzer/rule/version history; provide safe retention links between revisions.
- [ ] **P12-D06 — Artifact abstraction:** Implement local and S3-compatible artifact interfaces, content digests, tenant paths, lifecycle, and integrity checks.
- [ ] **P12-D07 — Local artifacts:** Add atomic local artifact storage, permissions, quotas, cleanup, backup integration, and corruption detection.
- [ ] **P12-D08 — S3-compatible artifacts:** Add multipart/resumable operations where needed, encryption configuration, presigned access controls, and retention behavior.
- [ ] **P12-D09 — NATS JetStream foundation:** Define durable streams/consumers, message schemas, deduplication IDs, acknowledgements, retries, and dead-letter strategy.
- [ ] **P12-D10 — Orchestrator state machine:** Implement revision-bound job scheduling, idempotency, cancellation, supersession, retry policy, and stale-result rejection.
- [ ] **P12-D11 — Worker protocol:** Define immutable job inputs, version/capability negotiation, result/artifact submission, heartbeats, timeouts, and failure states.
- [ ] **P12-D12 — Isolated worker runtime:** Execute repositories in restricted ephemeral workspaces with quotas and no implicit network.
- [ ] **P12-D13 — Worker registration/scaling:** Add worker pools, capability labels, concurrency controls, draining, health, and per-tenant fairness.
- [ ] **P12-D14 — Optional Valkey:** Add only for justified ephemeral caching/coordination; the platform remains correct without it.
- [ ] **P12-D15 — API/control-plane skeleton:** Implement versioned APIs, validation, error contracts, authentication hooks, request IDs, and OpenAPI documentation.
- [ ] **P12-D16 — Repository registration:** Register source identity/integration metadata without retaining more source than configured; validate authorization and supported modes.
- [ ] **P12-D17 — Analysis API:** Start/cancel/query revision-bound analyses, retrieve status/manifests/artifacts, and prevent stale result satisfaction.
- [ ] **P12-D18 — Manifest/history API:** Retrieve exact/canonical manifests, compare revisions, show versions/digests, and enforce tenant/repository scope.
- [ ] **P12-D19 — Identity/users:** Implement users, invitations or configured identity mapping, session/token handling, and account lifecycle.
- [ ] **P12-D20 — Teams/service accounts:** Implement teams, memberships, scoped service accounts, token rotation, expiry, and audit events.
- [ ] **P12-D21 — RBAC:** Define organization/team/repository roles and least-privilege permissions for analysis, evidence, policies, appeals, waivers, suspensions, and administration.
- [ ] **P12-D22 — Cross-tenant tests:** Attempt ID/path/query/artifact/event confusion across tenants and prove isolation at API, database, queue, storage, and cache layers.
- [ ] **P12-D23 — Organization policy:** Implement versioned policy bundles, inheritance/precedence, explicit blocking opt-in, approval, dry-run, and audit history.
- [ ] **P12-D24 — Appeals:** Implement create/review/adjudicate/terminal outcomes, immutable finding link, actor/authorization, comments/evidence, and audit records.
- [ ] **P12-D25 — Waivers:** Implement explicit scopes and conditional identities/selectors/approvals; preserve originals and minimum `warn` behavior.
- [ ] **P12-D26 — Waiver expiry/revocation:** Schedule/react to expiry/revocation, re-evaluate applicable findings, and expose reactivation history.
- [ ] **P12-D27 — Suppressions:** Implement distinct authorized suppression behavior without conflating it with waivers or suspension and without deleting findings.
- [ ] **P12-D28 — Rule graduation:** Store version-specific evidence/metrics/gates and allow eligibility only when every Phase 11 condition is proven.
- [ ] **P12-D29 — Suspension administration:** Implement repository/organization/global scopes, reasons, authorization, timestamps, visible advisory/`not_evaluated` results, and audit events.
- [ ] **P12-D30 — Audit log:** Make security/policy/appeal/waiver/suspension/repository/access events append-only, searchable, exportable, and retention-aware.
- [ ] **P12-D31 — Dashboard foundation:** Build accessible navigation, authentication, tenant/repository selection, status/error states, and API version handling.
- [ ] **P12-D32 — Current PR decisions:** Show exact revision/status/policy, staleness, coverage, timestamps, versions, and top actions.
- [ ] **P12-D33 — Contracts/consumers:** Show breaking/potential contracts, direct/transitive consumers, evidence paths, confidence, and truncation.
- [ ] **P12-D34 — Tests/unknowns:** Show required/recommended/missing tests, commands, analyzer health, unsupported files, gaps, and unknowns.
- [ ] **P12-D35 — Governance views:** Show appeals, waivers, suppressions, suspensions, expiration, authorization, and audit trail.
- [ ] **P12-D36 — Historical evidence:** Show manifest comparisons, rule/analyzer versions, past decisions, trends, and immutable source evidence references.
- [ ] **P12-D37 — Graph explorer:** Add last, as a secondary expandable evidence tool; preserve the result hierarchy over graph-first presentation.
- [ ] **P12-D38 — OpenTelemetry:** Instrument API, orchestrator, worker, queue, database, storage, and analysis with traces, metrics, and structured logs.
- [ ] **P12-D39 — Operational dashboards/alerts:** Add latency, error, crash/timeout, stale-report, queue lag, worker saturation, storage, and tenant-resource views.
- [ ] **P12-D40 — Retention/deletion:** Implement organization/repository/source/artifact/manifest policies, legal/config constraints, verified deletion, and auditability.
- [ ] **P12-D41 — Backup:** Define and automate consistent PostgreSQL, artifact, configuration, key/secret-reference, and migration-state backups.
- [ ] **P12-D42 — Restore:** Restore into a clean environment and verify manifests, graph, audit, users/policy, artifacts, and digest integrity.
- [ ] **P12-D43 — Docker Compose:** Build documented install/configure/upgrade/rollback/uninstall flows with health checks and persistent volumes.
- [ ] **P12-D44 — Helm:** Build versioned charts, values/schema, secrets references, probes, resources, security context, migrations, scaling, and rollback.
- [ ] **P12-D45 — Air-gapped artifact plan:** Inventory images/packages/charts/SBOM/signatures, define offline transfer/verification, and eliminate mandatory external calls.
- [ ] **P12-D46 — Upgrade/preflight:** Implement compatibility checks, schema/data migrations, mixed-version constraints, backups, dry-run, and rollback safety.
- [ ] **P12-D47 — Resource isolation:** Enforce per-tenant/repository/job quotas, backpressure, concurrency, storage budgets, and fair scheduling.
- [ ] **P12-D48 — Noisy-neighbor/load test:** Prove one large repository cannot exhaust resources for all tenants; test PR storms, cancellation, and recovery.
- [ ] **P12-D49 — Optional customer AI:** Add a disabled-by-default customer-provided model integration limited to explaining existing evidence; never create authoritative evidence or alter status/policy/waivers.
- [ ] **P12-D50 — Platform release gate:** Perform clean installs, upgrade/rollback, backup/restore, cross-tenant authorization, retention/deletion, noisy-neighbor, air-gap-plan, and audit/lifecycle checks.

## Dashboard priority order

1. Current pull-request decisions.
2. Breaking contracts.
3. Affected consumers.
4. Required and missing tests.
5. Unknowns and analyzer health.
6. Appeals, waivers, and suspensions.
7. Historical evidence.
8. Graph explorer.

## Phase 12 exit gate

- A clean installation succeeds.
- Upgrade and rollback succeed.
- Backup and restore succeed.
- Cross-tenant authorization tests pass.
- Source retention and deletion controls are verified.
- One large repository cannot exhaust resources for every tenant.

---

# PHASE 13 — Industrial Hardening and 1.0 Release

**Duration:** 35 workdays (7 weeks)
**Objective:** Prove the whole product is reliable, secure, performant, compatible, operable, and honestly documented for 1.0.

## Daily execution plan

- [ ] **P13-D01 — Reliability inventory:** Map every job/API/storage/queue failure mode, ownership, retry/idempotency behavior, user-visible state, and recovery path.
- [ ] **P13-D02 — Idempotency/retries:** Harden idempotency keys, bounded exponential retries, poison-message handling, and safe repeated publication.
- [ ] **P13-D03 — Dead-letter operations:** Implement dead-letter queues, inspection/replay authorization, deduplication, retention, and audit.
- [ ] **P13-D04 — Backpressure/quotas:** Validate worker/API/queue/storage limits, tenant fairness, overload rejection, and graceful degradation.
- [ ] **P13-D05 — SLOs/error budgets:** Define supported availability/latency/correctness indicators, measurement, alerting, error-budget policy, and 99.9% Self-Hosted availability target.
- [ ] **P13-D06 — Runbooks/incident response:** Write analyzer, queue, database, storage, auth, stale-result, data-integrity, and security incident procedures plus escalation/communications.
- [ ] **P13-D07 — Status-page process:** Define component states, incident/update templates, responsibility, resolution/postmortem workflow, and customer communication.
- [ ] **P13-D08 — Disaster recovery:** Document and rehearse loss/corruption/region-or-host failure recovery with recovery objectives and integrity checks.
- [ ] **P13-D09 — Chaos testing:** Inject process loss, duplicate/delayed messages, dependency failure, disk pressure, network partitions, timeouts, and recovery.
- [ ] **P13-D10 — Rootless isolation:** Run repository analysis as non-root in isolated environments with read-only root filesystem.
- [ ] **P13-D11 — Container restrictions:** Remove privileged containers, drop capabilities, restrict syscalls, use minimal images, and test escape boundaries.
- [ ] **P13-D12 — Network controls:** Disable outbound network by default, document explicit exceptions, prevent metadata/service access, and test egress denial.
- [ ] **P13-D13 — Resource limits:** Enforce CPU, memory, process, disk, file, and time limits; convert exhaustion into safe explicit states.
- [ ] **P13-D14 — SCM credentials:** Use short-lived least-privilege credentials, avoid persistence/logging, rotate safely, and test revocation.
- [ ] **P13-D15 — Secret redaction:** Redact logs/errors/artifacts/evidence previews, test encoded/structured variants, and document residual risks.
- [ ] **P13-D16 — Supply-chain security:** Finalize dependency/secret/license scans, SBOM, signed release artifacts, provenance, pinning, and verification instructions.
- [ ] **P13-D17 — Independent security review:** Arrange and remediate an independent review before enterprise security claims; record accepted residual risks.
- [ ] **P13-D18 — Parser-cache optimization:** Validate content-addressed cache correctness/versioning, hit rate, corruption recovery, and no cross-tenant leakage.
- [ ] **P13-D19 — Incremental graph optimization:** Profile invalidation/update/query behavior and verify equality with clean rebuilds.
- [ ] **P13-D20 — Parallel analyzers:** Add bounded parallelism, deterministic merge order, cancellation, quotas, and safe partial-failure semantics.
- [ ] **P13-D21 — Large-monorepo benchmarks:** Test representative large workspaces, publish repository classes and latency/resource results honestly.
- [ ] **P13-D22 — PR storm/load tests:** Test burst concurrency, force-push cancellation, duplicate events, queues, storage, quotas, and recovery.
- [ ] **P13-D23 — Performance targets:** Measure/optimize CLI startup under 1 second; small PR under 30 seconds; medium PR under 2 minutes; large PR under 5 minutes, revising targets only with published benchmark evidence.
- [ ] **P13-D24 — Language/framework matrix:** Publish supported/partial/unsupported versions, patterns, platforms, evidence guarantees, and limitations.
- [ ] **P13-D25 — Schema/version matrices:** Publish manifest-schema support and analyzer/rule-set compatibility matrices across CLI, Action, MCP, and Self-Hosted.
- [ ] **P13-D26 — Config migration/deprecation:** Implement migration tooling, deprecation warnings/timelines, removal policy, and rollback guidance.
- [ ] **P13-D27 — Self-Hosted support policy:** Define long-term support scope, patch/security windows, supported upgrade paths, and upgrade preflight checks.
- [ ] **P13-D28 — End-to-end vertical:** From a TypeScript change, identify contracts/consumers/tests/gaps and reproduce one normalized manifest through CLI, GitHub, MCP, and Self-Hosted.
- [ ] **P13-D29 — Failure-state audit:** Exhaustively prove no required analyzer crash, timeout, incomplete result, stale revision, invalid config/schema, or storage failure converts to `pass`.
- [ ] **P13-D30 — Governance audit:** Exercise appeals, every waiver scope, waiver expiry/reactivation, suppressions, all suspension scopes, emergency disable, and immutable/audited findings end to end.
- [ ] **P13-D31 — Blocking audit:** Recalculate every candidate against independent graduation gates; enable only qualified, explicitly opted-in rules and leave all others advisory.
- [ ] **P13-D32 — Metrics publication:** Publish segmented ChangeBench and real-partner accuracy, test-usefulness, developer-usefulness, operational-health, determinism, limitations, and repository-class results.
- [ ] **P13-D33 — Documentation completion:** Finish installation, local/CI/MCP/Self-Hosted use, security, privacy, operations, backup/recovery, upgrades, compatibility, policies, appeals/waivers/suspensions, and known limitations/unsupported patterns.
- [ ] **P13-D34 — Release candidate:** Build signed/SBOM-backed artifacts, run the complete matrix and fresh-install/upgrade/rollback/restore/load/security regression suites, and freeze release notes.
- [ ] **P13-D35 — 1.0 gate/release:** Verify every definition-of-done item, publish artifacts/docs/metrics, and release only if all safety and industrial gates pass.

## Phase 13 / 1.0 release gate

- The TypeScript vertical works end to end.
- CLI, Action, MCP, and Self-Hosted use one manifest contract.
- ChangeBench and real-partner metrics are published honestly.
- No known path converts failed required analysis into `pass`.
- Appeals, waivers, suspended rules, and expiry/reactivation work end to end.
- Blocking is enabled only for independently qualified rules.
- Documentation contains known limitations and unsupported patterns.
- Some rules may remain advisory-only; a deadline never makes a rule safe to block.

---

# CROSS-CUTTING PRODUCT METRICS

Collect these throughout Phases 2–13 and publish them honestly in Phase 13.

## Accuracy

- Precision and recall per rule.
- False-positive and false-negative counts.
- Unexpected-result rate.
- Unsupported-file rate.
- Incomplete-analysis rate.
- Evidence-resolution rate.
- Semantic determinism rate.

## Test usefulness

- Relevant-test selection recall.
- Accepted missing-test findings.
- Time to first failing relevant test.
- Full-suite comparison results.

## Developer usefulness

- Findings accepted, appealed, waived, and suppressed.
- Median findings per pull request.
- Time to understand a report.
- Percentage of pull requests where recommendations changed developer action.
- Repeat usage and GitHub Action retention.

## Operational health

- Analysis latency percentiles.
- Analyzer crash/timeout rate.
- Stale-report rate.
- Queue lag.
- Resource consumption by repository class.

Every metric is segmented by language, framework pack, rule, analyzer version, and repository type. Aggregate scores must never hide a weak rule class.

---

# COST-CONTROL PLAN

The active roadmap can be developed without paid infrastructure:

- Use local development for the kernel and CLI.
- Use a public GitHub repository and free public CI where appropriate.
- Run the GitHub Action on repository-owner compute.
- Use SQLite and local filesystem for CLI.
- Use PostgreSQL, NATS, optional Valkey, and observability in local containers.
- Use Docker Compose and k3d for Self-Hosted validation.
- Require no cloud model or model API.
- Do not introduce managed Kubernetes, Kafka, OpenSearch, or a graph database.
- Users/customers provide compute for GitHub Action and Self-Hosted deployments.
- Operating costs appear only if ByteSmith Cloud is intentionally activated later.

---

# DEFERRED AND CUSTOMER-TRIGGERED ROADMAP

These items are deliberately outside the 385-day active schedule. They are not forgotten; each has an explicit activation gate.

## Cross-repository contracts

Build only after a committed customer needs producer/consumer relationships across repositories. Monorepo and multi-package support remains first. When activated, add cross-repository identity, authorization, revision consistency, ChangeBench coverage, evidence, and operational design.

## Runtime confirmation

Build only when a customer has compatible telemetry, accepts the privacy model, and runtime evidence addresses a measured static-analysis blind spot. ByteSmith must not become a general observability product.

## Additional languages

Add Java, Python, Go, and C# based on measured demand. Every language needs a compatibility matrix, ChangeBench fixtures, evidence guarantees, analyzer failure behavior, and per-rule metrics.

## COBOL/mainframe

Not on the current roadmap. Activation requires a design partner, COBOL specialist, dialect fixtures, defined JCL and embedded-SQL scope, and a narrow verified use case.

## ByteSmith Cloud

Defer until adoption or revenue funds hosted compute, storage, security, operations, and support. CLI, GitHub Action, and Self-Hosted must remain complete products without Cloud.

---

# FIRST 30 DAYS — QUICK EXECUTION VIEW

This is a compact view of P0-D01 through P2-D05; use the detailed phase entries as the source of truth.

## Week 1

- Create the repository skeleton and contribution rules without freezing unstable public APIs.
- Write product invariants and corrected result-state semantics.
- Define suspended-rule behavior.
- Define waiver scopes and conditional requirements.
- Define appeal terminal outcomes.

## Week 2

- Write the Impact Manifest and shared evidence/component schemas.
- Write the ChangeBench schema with required `allowUnexpected`.
- Write semantic validation and canonicalization/digest rules.

## Week 3

- Implement schema and semantic validators.
- Add automated appeal and waiver lifecycle checks.
- Validate/freeze Phase 0 and record ADRs.

## Week 4

- Build the pnpm/TypeScript workspace, strict settings, quality/test tools, and CI matrix.
- Add release, security, SBOM, compatibility, and architecture guardrails.

## Week 5

- Prove clean-checkout/reproducible releases.
- Build the ChangeBench runner, matchers, `allowUnexpected`, normalization, and metrics.

## Week 6

- Begin the first contract and consumer fixtures using the detailed Phase 2 ordering.
- Publish the first internal deterministic benchmark report when the current fixture subset passes.

The repository skeleton may be created during Phase 0, but no unstable domain interface becomes public until the Phase 0 schema review is complete.

---

# FINAL DEFINITION OF DONE

ByteSmith 1.0 is complete only when all of the following are true:

- A developer runs one local command against a TypeScript change.
- ByteSmith identifies changed contracts with deterministic evidence.
- It connects contracts to direct and supported transitive consumers.
- It recommends relevant tests and identifies test gaps.
- It exposes unsupported and unknown analysis paths honestly.
- The same normalized Impact Manifest is produced locally, in GitHub, through MCP, and in Self-Hosted mode.
- Required analyzer failures can never appear as `pass`.
- Suspended-rule findings remain visible.
- Waivers are explicitly scoped, audited, expire safely, and reactivate still-applicable findings on re-evaluation.
- ChangeBench contains positive, negative, unsupported, suspended, failure, unexpected-result, and waiver-lifecycle cases.
- Real design-partner evidence validates usefulness beyond synthetic fixtures.
- Blocking rules satisfy independent graduation gates and explicit repository opt-in.
- CLI, GitHub Action, and Self-Hosted require no ByteSmith Cloud.
- Security, upgrade, backup, recovery, compatibility, retention/deletion, operations, and known-limitations documentation is complete.

---

# TOTAL TIME TO COMPLETE

## Full-time solo developer

- **Planned baseline:** 385 focused workdays = 77 workweeks = approximately **17.7 calendar months**.
- **Realistic range:** **14–20 months**. Fourteen months requires strong existing expertise, prompt partner access, low rework, and selective safe overlap. Twenty months allows for difficult accuracy work, security remediation, platform hardening, holidays, and partner delays.
- **Strictly sequential execution:** Use the 17.7-month baseline.
- **Recommended controlled overlap:** Run design-partner shadow work alongside GitHub/MCP and early Self-Hosted work; this can save several calendar weeks but never shortens required evidence windows or graduation gates.

## Team of three to four experienced engineers

- **Estimated calendar time:** **7–11 months**.
- Natural parallel lanes are: analyzer/contracts; graph/test intelligence/CLI; GitHub/MCP; and Self-Hosted/security/operations.
- Phase 0 semantics, shared-kernel contracts, integration gates, real-partner evidence, and 1.0 hardening remain coordination bottlenecks.

## What the estimate excludes

The estimate excludes the customer-triggered items: ByteSmith Cloud, COBOL/mainframe, cross-repository contracts, runtime telemetry confirmation, and Java/Python/Go/C# analyzers. Their scope and time can be estimated only after their activation requirements are met.
