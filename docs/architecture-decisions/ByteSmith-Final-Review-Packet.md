# ByteSmith — Final Project Review Packet

## Instructions for the final reviewer

Please review this as the final pre-implementation specification for ByteSmith.
The product direction is intentionally frozen. The objective is not to propose
another pivot or reopen broad ideation. Please identify only:

1. Contradictions between sections.
2. Missing product or engineering invariants.
3. Schema semantics that could create false confidence.
4. ChangeBench gaps that would make accuracy claims misleading.
5. Security, privacy, determinism, or deployment blockers.
6. Requirements that are impossible to test objectively.
7. Module-ordering mistakes that would cause expensive rework.
8. Any issue serious enough that implementation should not begin.

For every issue, classify it as:

- **Blocker:** must be resolved before implementation.
- **Important:** may be resolved during the relevant implementation phase.
- **Later:** legitimate concern but intentionally outside the current critical path.

If there are no blockers, explicitly conclude that the project is ready to move
into repository scaffolding and implementation.

---

# 1. Final decision

ByteSmith will be built as:

> **A local-first verification engine that connects changed contracts to affected consumers and required tests, then produces reproducible, appealable, and auditable evidence before merge.**

Primary tagline:

> **Prove the impact before you merge.**

Secondary explanation:

> Contracts, consumers, tests, and unknowns—verified from the code and tied to exact commits.

ByteSmith is not primarily a code graph, repository chatbot, coding agent, API
diff utility, or legacy-code translator. Those may be technologies or future
capabilities, but they do not define the product.

The product connects four questions that are normally answered by unrelated
tools:

1. What contract changed?
2. Which components consume that contract?
3. Which tests verify those affected components?
4. What could ByteSmith not determine?

The resulting answer is stored in one versioned **Impact Manifest**.

---

# 2. Why this direction was selected

The original ideas included AI code generation, repository intelligence,
legacy modernization, and binary analysis. The project initially leaned toward
a broad repository digital twin and, briefly, COBOL/mainframe modernization.

That direction was rejected for the first product because:

- Mainframe buyers have long, conservative enterprise procurement cycles.
- Correct COBOL analysis requires dialect knowledge, JCL, CICS, DB2, VSAM,
  embedded SQL, operational context, and access to real mainframe applications.
- IBM already offers mainframe discovery, dependency mapping, explanation,
  refactoring, transformation, testing, on-premises deployment, and existing
  customer relationships.
- AWS Blu Age is an AWS mainframe-modernization product, not an OpenText product.
- A COBOL-first strategy conflicts with a self-service CLI and GitHub Action
  adoption model.

COBOL is therefore not part of the current roadmap. It may become a future
language pack only after ByteSmith has a working product, a real design partner,
COBOL expertise, representative fixtures, and a narrow verified use case.

---

# 3. Target user and market entry

## Initial target

Engineering teams with approximately 10–100 developers that:

- Use TypeScript and JavaScript.
- Maintain monorepos or several connected services.
- Review changes through GitHub pull requests.
- Have at least partial automated testing.
- Use or are adopting coding agents.
- Care about breaking changes, test selection, and review confidence.
- Prefer local or self-hosted analysis for source-code privacy.

## Not initially targeted

- Individual developers with tiny repositories.
- Banks seeking automatic COBOL-to-Java transformation.
- Government procurement programs.
- Teams without source control.
- Organizations requiring every programming language immediately.
- Users looking primarily for a general-purpose AI coding assistant.

## Initial ecosystem

ByteSmith will go deep on this stack first:

- TypeScript and JavaScript
- npm, pnpm, and yarn
- TypeScript project references and common monorepo layouts
- React and Next.js
- Express and NestJS
- Prisma initially; other ORMs later
- OpenAPI and GraphQL
- Common event-schema patterns
- Jest, Vitest, and Playwright

Language order after TypeScript, based on demonstrated demand:

1. Java
2. Python
3. Go
4. C#
5. Other languages requested by real adopters

---

# 4. Current deployment commitment

The first product will have three distributions:

## 4.1 ByteSmith CLI

- Runs on the developer's computer.
- Requires no account or source upload.
- Uses local storage, initially SQLite and the filesystem.
- Produces human-readable and JSON Impact Manifests.
- Serves as the shared analysis kernel used by other interfaces.

Example:

```bash
npx bytesmith analyze --base main
bytesmith impact --base main --format json
bytesmith test-plan --base main
bytesmith verify-impact impact.json
```

## 4.2 ByteSmith GitHub Action

- Runs in the repository owner's CI environment.
- Does not require ByteSmith-hosted compute.
- Generates or updates one pull-request report.
- Begins in advisory mode.
- Uses exactly the same engine and manifest semantics as the CLI.

Example:

```yaml
- uses: bytesmith-ai/impact@v1
  with:
    fail-on: breaking-contract
```

## 4.3 ByteSmith Self-Hosted

- Runs through Docker Compose and, later, Helm.
- Adds persistent repository history, multi-user access, policies, audit logs,
  dashboards, and optional organization-wide analysis.
- Keeps source code and analysis inside customer-controlled infrastructure.

## 4.4 ByteSmith Cloud

Cloud hosting is explicitly deferred. It will be considered only after adoption,
revenue, sponsorship, cloud credits, or a paying design partner can fund it.
Cloud is not on the current critical path.

---

# 5. Competitive reality and differentiation

ByteSmith does not assume that code graphs, contract diffs, MCP, or impact
analysis are individually unique.

Existing product categories already include:

- Code search and navigation platforms.
- Enterprise architecture and impact visualization.
- API, GraphQL, and Protobuf breaking-change detectors.
- Test-selection and coverage tools.
- Repository graphs exposed to coding agents.
- AI pull-request reviewers.
- Mainframe modernization suites.

ByteSmith's differentiation target is the connected, deterministic workflow:

```text
Changed contract
      ↓
Compatibility classification
      ↓
Affected consumers
      ↓
Required and missing tests
      ↓
Evidence and analysis gaps
      ↓
Versioned Impact Manifest
```

The marketing claim must not be “we detect API changes.” Narrow tools already
do that. The claim is:

> ByteSmith tells you that a contract changed, who it affects, what verifies it,
> and what remains unknown—in one reproducible artifact.

The dependency graph is an internal engine and investigation surface, not the
main marketing product.

---

# 6. What may become defensible

The Impact Manifest concept alone is not a moat; competitors can reproduce it.
Defensibility must accumulate through five assets.

## 6.1 ChangeBench

A public accuracy benchmark with labelled changes, expected impacts, forbidden
false positives, required tests, and expected unknowns.

## 6.2 Framework Packs

Framework-aware analyzers for routing, dependency injection, schemas, ORMs,
events, tests, and generated clients.

There is a recognized cold-start problem: Framework Packs are not an ecosystem
moat until outside contributors maintain them. Through the early phases they are
first-party engineering work.

Progression:

1. First-party packs.
2. Stable Framework Pack SDK.
3. Pack documentation and fixtures.
4. One external experimental pack.
5. Compatibility certification.
6. Community registry.

Only steps 4–6 constitute evidence of an ecosystem.

## 6.3 Historical verification data

The self-hosted system can accumulate relationships among changes, tests,
failures, runtime behavior, accepted findings, and overrides. This information
stays in the customer's environment.

## 6.4 Reproducibility

The same revisions, configuration, engine, analyzer versions, and rule set must
produce identical normalized semantic results locally and in CI.

## 6.5 Trust and transparency

ByteSmith must show what it verified, inferred, could not analyze, and used as
evidence. Trust is more important than an unexplained AI risk score.

---

# 7. Core product outputs

## 7.1 Contract changes

The initial system should understand:

- TypeScript exports and public type members
- Function and method signatures across package boundaries
- REST/OpenAPI endpoints and schemas
- GraphQL schemas
- Prisma schemas and migrations
- Event names and schemas
- Environment variables and configuration keys
- Package exports
- CLI interfaces
- Shared types crossing module or package boundaries

## 7.2 Consumers

ByteSmith should connect a changed contract to:

- Direct imports and calls
- Transitive dependents
- API clients
- GraphQL consumers
- Event consumers
- Database readers and writers
- Package dependents
- Configuration users
- Generated clients when supported

## 7.3 Tests

ByteSmith should identify:

- Tests directly importing affected code
- Tests covering affected code through coverage data
- Integration and end-to-end tests tied to affected routes or contracts
- Exact commands for running relevant tests
- Affected behavior for which no adequate test evidence exists

ByteSmith will not initially skip the complete test suite automatically. Test
selection must first run in shadow and advisory modes against historical results.

## 7.4 Unknowns

Unknowns are first-class results:

- Unsupported changed files
- Dynamic imports
- Reflection
- Dependency-injection relationships that could not be resolved
- Generated code without a supported generator pack
- Missing consumer repositories
- Unresolved symbols
- Required analyzer gaps

ByteSmith must never convert an unknown into silent success.

---

# 8. Impact Manifest

The Impact Manifest is the canonical contract shared by the CLI, GitHub Action,
MCP server, and self-hosted UI.

It contains:

- Schema version
- Manifest identity and timestamp
- Engine and rule-set versions
- Repository identity
- Base, head, and merge-base revisions
- Configuration digest
- Derived result state
- Full changed-file scope
- Measured analysis coverage
- Analyzer outcomes
- Evidence records
- Semantic changes
- Affected components
- Recommended tests
- Test gaps
- Unknowns
- Policy results
- Waivers and dispositions
- Semantic integrity digest
- Optional signature

Illustrative shape:

```json
{
  "schemaVersion": "1.0.0",
  "manifestId": "manifest_123",
  "generatedAt": "2026-08-18T12:00:00Z",
  "engine": {
    "name": "ByteSmith",
    "version": "1.0.0",
    "ruleSetVersion": "1.0.0"
  },
  "repository": {
    "id": "payments-api",
    "name": "payments-api",
    "vcs": "git"
  },
  "comparison": {
    "baseRevision": "abc123",
    "headRevision": "def456",
    "mergeBaseRevision": "abc123"
  },
  "status": {
    "conclusion": "warn",
    "reasons": [
      {
        "code": "BREAKING_CONTRACT",
        "summary": "One breaking contract change affects an existing consumer."
      }
    ]
  },
  "scope": {
    "coverage": {
      "totalChangedFiles": 22,
      "analyzed": 18,
      "partiallyAnalyzed": 0,
      "unsupported": 4,
      "intentionallyExcluded": 0,
      "changedSymbols": 45,
      "resolvedChangedSymbols": 42,
      "contractsFound": 6,
      "contractsAnalyzed": 6
    },
    "files": []
  },
  "analyzers": [],
  "evidence": [],
  "changes": [],
  "impacts": [],
  "tests": {
    "recommended": [],
    "gaps": []
  },
  "unknowns": [],
  "policies": [],
  "waivers": [],
  "integrity": {
    "semanticDigest": {
      "algorithm": "sha256",
      "value": "abcdef"
    }
  }
}
```

After final review, these semantics will be materialized as the normative JSON
schemas listed in the implementation artifact plan.

---

# 9. Non-negotiable product invariants

## 9.1 Full-diff denominator

The denominator for changed-file coverage is every file path touched by the
source-control diff before filtering by language, relevance, generated status,
ignore configuration, or analyzer support.

Every changed path must appear exactly once in one bucket:

- `analyzed`
- `partially_analyzed`
- `unsupported`
- `intentionally_excluded`

Unsupported, ignored, and generated files remain visible in the denominator.
They cannot be silently excluded to produce a cleaner coverage result.

## 9.2 Measured coverage, not unknowable completeness

ByteSmith reports measurable facts:

```text
Changed files in diff:       22
Changed files analyzed:      18
Changed files unsupported:    4
Changed symbols found:       45
Changed symbols resolved:    42
Contracts found/analyzed:   6/6
Dynamic imports unresolved:   3
```

It must not claim “86% of all real dependencies were discovered,” because it
cannot know every relationship it failed to see.

User-facing language:

> No blocking impact was found within ByteSmith's analyzed scope.

Forbidden language:

> This change is safe.

## 9.3 Incomplete is never pass

If any required analyzer returns `incomplete`, the manifest is `incomplete`
unless a required analyzer returns `error`, which takes precedence.

Timeouts, crashes, invalid analyzer output, unsupported required input, and
platform failures cannot become `pass`.

## 9.4 Exact revision binding

Every result is tied to exact base, head, and merge-base revisions. A report for
an earlier head commit must not be published as current after the PR changes.

## 9.5 Evidence or explicit heuristic

Every authoritative change and impact includes evidence. A heuristic result
must be labelled heuristic and cannot silently become deterministic evidence.

## 9.6 Immutable findings

Appeals, waivers, suppressions, and later analyses add records. They do not
delete or rewrite the original finding.

## 9.7 Deterministic core

Identical source, configuration, revisions, engine version, analyzer versions,
and rule set produce identical normalized semantic output. Timestamps,
durations, temporary paths, and run IDs are excluded from semantic equality.

## 9.8 AI cannot create authoritative evidence

An LLM may summarize evidence and propose remediation. It cannot create an
authoritative dependency edge, contract classification, blocking result, or
coverage fact without deterministic provenance.

## 9.9 Blocking is rule-specific and opt-in

Blocking eligibility belongs to a rule version, not ByteSmith as a whole. Each
repository explicitly enables blocking rules or an approved policy bundle.

## 9.10 Semantic validation

In addition to JSON Schema validation, the semantic validator checks:

- Full-diff total equals the number of listed changed files.
- Coverage buckets sum to the full-diff total.
- Every file belongs to one and only one bucket.
- All referenced changes, findings, evidence, rules, tests, and waivers exist.
- The result conclusion matches the derivation algorithm.
- Active waivers include actor, reason, scope, and validity information.
- Integrity hashes use declared algorithms.

---

# 10. Result-state model

The only manifest conclusions are:

- `pass`
- `warn`
- `fail`
- `incomplete`
- `error`

Meanings:

- `pass`: no enabled blocking rule failed and no advisory condition or active
  waiver requires attention within successfully analyzed scope.
- `warn`: advisory findings, active waivers, or non-required gaps require
  attention, but no enabled blocking rule failed.
- `fail`: an enabled, blocking-eligible, non-waived rule failed.
- `incomplete`: required analysis did not complete, but a valid partial manifest
  was produced.
- `error`: a fatal platform, integrity, input, or required-analyzer error
  prevented valid required analysis.

Derivation precedence:

1. Required analyzer error → `error`.
2. Required analyzer incomplete → `incomplete`.
3. Active non-waived blocking violation → `fail`.
4. Advisory finding, active waiver, or non-required analysis gap → `warn`.
5. Otherwise → `pass`.

The result is derived. It cannot be directly set by an LLM, plugin, adapter, or UI.

---

# 11. Appeals, waivers, and suppressions

Every finding supports:

- Accept
- Appeal as incorrect
- Mark as expected
- Temporarily waive
- Permanently suppress by policy

Finding dispositions:

- `open`
- `accepted`
- `appealed`
- `waived`
- `suppressed`
- `resolved`

A waiver records:

- Finding ID
- Reason
- Actor
- Creation time
- Optional expiry
- Scope
- Status

Rules:

- The original finding remains immutable.
- `waived` is not the same as `pass`; an active waiver produces at least `warn`.
- A reason is mandatory.
- Temporary waivers expire.
- Permanent suppression requires elevated authorization.
- Every change is audit logged.
- Developers can appeal without needing full administrator access.
- Override and appeal rates are measured per rule version and scope.

## Waiver expiry

Expiry does not rewrite a historical manifest.

After expiry:

- The waiver becomes inactive.
- The finding becomes active during the next evaluation if still applicable.
- Self-hosted ByteSmith should queue revalidation and create an advisory debt
  item if the waived change has already merged.
- Stateless CLI and GitHub Action runs surface the expired waiver on the next
  invocation but cannot retroactively block an already merged PR.
- An expired waiver never changes an old manifest to `pass`.

---

# 12. Rule graduation and suspension

Each rule version progresses independently:

```text
experimental
    ↓
advisory
    ↓
blocking_eligible
    ↓
blocking_enabled per repository
    ↓
suspended after regression
```

## Graduation requirements

A rule may become blocking eligible only when all conditions hold:

1. ChangeBench precision is at least 99% for the rule class.
2. ChangeBench recall is at least 95% for the rule class.
3. The result is stable across three consecutive released analyzer versions.
4. At least 200 real advisory findings have been observed.
5. Findings span at least three unrelated design-partner repositories.
6. No unresolved high-severity false positive occurred in the latest 100 findings.
7. Every blocking finding contains a complete deterministic evidence path.
8. Local and CI semantic outputs match for identical inputs.
9. Analyzer failure is proven to produce `incomplete` or `error`, never `pass`.
10. Repository administrators explicitly enable enforcement.
11. An emergency repository-level disable control exists and is audited.
12. The appeal and waiver workflow has been exercised.
13. At least one real discrepancy completed investigation and regression-fixture
    creation, or an independent adversarial evaluation challenged the rule.

A real discrepancy must not be manufactured merely to satisfy the gate. If no
real error appears after a meaningful sample, independent adversarial testing
satisfies the intent.

## Suspension blast radius

Every suspension declares a scope:

- `repository`: default for a local override spike or unusual repository pattern.
- `organization`: repositories sharing a problematic configuration or framework.
- `global`: only for a general rule/analyzer regression supported by ChangeBench
  failure or corroborated evidence across unrelated repositories.

One unusual repository cannot silently disable a rule globally. A confirmed
general regression cannot be hidden as a repository-only problem.

Suspension is visible and audited. Lack of enforcement must not appear as a clean pass.

---

# 13. ChangeBench

ChangeBench exists before the analyzer so correctness is judged against a
predefined expected answer rather than whatever the implementation happens to
produce.

## Fixture layout

```text
changebench/fixtures/<case-id>/
├── case.json
├── before/
├── after/
└── README.md
```

`before` and `after` are immutable snapshots. The expected answer is a matcher
over the Impact Manifest.

## Why a matcher is required

A benchmark expectation should not match runtime values such as:

- Run identifier
- Timestamp
- Duration
- Temporary absolute paths
- Machine information

Therefore, fixtures use partial semantic matchers rather than literal complete
manifests.

## Required assertion groups

- `requiredChanges`
- `forbiddenChanges`
- `requiredImpacts`
- `forbiddenImpacts`
- `requiredTests`
- `forbiddenTests`
- `requiredUnknowns`
- `forbiddenUnknowns`
- Exact coverage-bucket expectations
- Expected conclusion

Negative assertions are mandatory for precision measurement. A benchmark that
checks only that expected findings exist can hide unlimited noise.

Illustrative case:

```json
{
  "schemaVersion": "1.0.0",
  "id": "typescript-export-removed",
  "snapshots": {
    "before": "before",
    "after": "after"
  },
  "capabilities": [
    "typescript.exports",
    "typescript.references",
    "vitest.discovery"
  ],
  "expected": {
    "conclusion": "warn",
    "coverage": {
      "totalChangedFiles": 1,
      "analyzed": 1,
      "partiallyAnalyzed": 0,
      "unsupported": 0,
      "intentionallyExcluded": 0
    },
    "requiredChanges": [
      {
        "kind": "contract",
        "compatibility": "breaking",
        "componentName": "PaymentResponse.currency"
      }
    ],
    "requiredImpacts": [
      {
        "ruleId": "typescript.export-member-removed",
        "category": "contract",
        "affectedComponentName": "formatPayment"
      }
    ],
    "forbiddenImpacts": [
      {
        "affectedComponentName": "unrelatedAdminFunction"
      }
    ],
    "requiredTests": [
      {
        "testName": "formatPayment test"
      }
    ],
    "requiredUnknowns": [],
    "allowUnexpected": false
  }
}
```

One of the first ChangeBench fixtures must verify that unsupported files remain
in the full-diff denominator.

## Initial ChangeBench categories

Before the TypeScript analyzer is considered ready, create at least 20–30 cases
covering:

1. Safe internal implementation change
2. Exported function parameter added
3. Exported parameter removed
4. Required parameter introduced
5. Optional parameter introduced
6. Exported return type changed
7. Interface field removed
8. Optional interface field made required
9. Package export removed
10. OpenAPI request field removed
11. OpenAPI response field removed
12. GraphQL field removed
13. GraphQL argument made required
14. Prisma column removed
15. Prisma nullability changed
16. Event field removed
17. Event field made required
18. Direct consumer affected
19. Transitive consumer affected
20. Unrelated consumer forbidden
21. Relevant unit test selected
22. Relevant integration test selected
23. Affected behavior with no test
24. Dynamic import reported unknown
25. Path alias resolution
26. Circular dependency
27. Generated code explicitly classified
28. Ignored file remains in denominator
29. Unsupported file remains in denominator
30. Required analyzer crash produces `incomplete` or `error`

## Metrics

Publish per rule, language, framework pack, and engine version:

- Precision
- Recall
- F1 score
- False positives
- False negatives
- Required-test selection recall
- Unsupported-file rate
- Incomplete-analysis rate
- Semantic determinism rate
- Duration percentiles

Aggregate scores cannot hide a rule class that fails its blocking threshold.

---

# 14. Design-partner requirements

Before any GitHub rule becomes blocking eligible, ByteSmith must be evaluated
against 3–5 unrelated TypeScript codebases, preferably including:

- A pnpm/Nx/Turborepo monorepo
- A Next.js application
- A NestJS or Express backend
- A Prisma/PostgreSQL application
- An event-driven or multi-package application
- At least one older and inconsistent repository

The combined partner set should expose:

- Dynamic imports
- Path aliases
- Circular dependencies
- Dependency injection
- Generated code
- Incomplete tests
- Unusual repository layouts
- Shared internal packages
- Database migrations
- Real pull-request history

Completion requires either:

- A real incorrect result that reaches a human, is investigated, fixed, and
  converted into a regression fixture; or
- A completed independent adversarial review if no natural discrepancy appears
  after a meaningful sample.

Private code does not need to enter public ChangeBench. Aggregate results can be
published, and failures may become sanitized fixtures with permission.

---

# 15. AI and coding-agent position

ByteSmith is not anti-AI. Its message is:

> **ByteSmith combines deterministic program analysis with optional AI explanations. AI explains the evidence; it does not invent the evidence.**

AI may:

- Summarize an Impact Manifest
- Explain an evidence path
- Suggest tests
- Generate a review checklist
- Propose remediation
- Help coding agents consume structured findings

AI may not:

- Create authoritative graph relationships without deterministic provenance
- Hide analysis gaps
- Convert unsupported guesses into blocking conclusions
- Send private source externally without permission
- Directly set the manifest conclusion

## MCP integration

MCP is moved earlier than the full self-hosted dashboard because it is relatively
cheap once the manifest exists and helps defend against coding agents absorbing
the repository-understanding workflow.

Proposed narrow tools:

- `analyze_current_change`
- `get_changed_contracts`
- `get_affected_consumers`
- `get_recommended_tests`
- `get_missing_tests`
- `get_evidence_path`
- `get_analysis_unknowns`

Agents never receive unrestricted database access.

---

# 16. Technical architecture

## Shared kernel

The CLI, Action, MCP server, and self-hosted system use one analysis kernel.

```text
Source-control diff
       ↓
Repository inventory
       ↓
Language and framework analyzers
       ↓
Canonical intermediate representation
       ↓
Temporal dependency/contract graph
       ↓
Contract compatibility rules
       ↓
Consumer linkage
       ↓
Test intelligence
       ↓
Policy and status derivation
       ↓
Impact Manifest
```

## Zero-cost initial technology choices

- TypeScript and Node.js for the control plane, CLI, Action, and initial workers
- pnpm workspace/monorepo
- TypeScript Compiler API or ts-morph for semantic TypeScript analysis
- SQLite for local CLI state
- PostgreSQL for self-hosted persistent state and graph adjacency tables
- Local filesystem with an object-store interface for CLI
- S3-compatible adapter for self-hosted deployments
- NATS JetStream for self-hosted asynchronous work
- Valkey for optional caching and coordination
- PostgreSQL full-text search before considering OpenSearch
- Rootless Podman or equivalent hardened containers for untrusted execution
- Docker Compose first; Helm/k3d for self-hosted Kubernetes validation
- OpenTelemetry, Prometheus, Grafana, Loki, and Tempo for self-hosted observability
- No mandatory paid AI API

Kafka, OpenSearch, a specialized graph database, managed Kubernetes, and Cloud
hosting are not required until measurements justify them.

## Storage adapters

```text
Analysis kernel
├── SQLite adapter
├── PostgreSQL adapter
├── Local artifact adapter
├── S3-compatible artifact adapter
├── In-process queue adapter
└── NATS queue adapter
```

All adapters produce the same normalized manifest.

---

# 17. Security and privacy requirements

Repositories are untrusted input.

Static analysis must not execute project code by default. If builds or tests are
required, execution occurs in an ephemeral restricted environment with:

- Non-root user
- Read-only root filesystem
- No privileged mode
- Dropped operating-system capabilities
- CPU, memory, process, and time limits
- No outbound network by default
- No platform credentials mounted
- Ephemeral workspace destruction after completion

Additional requirements:

- No source upload for CLI and Action operation
- Customer-controlled data for self-hosted operation
- Secrets never appear in logs, manifests, prompts, or analytics
- Signed webhook validation for integrations
- Short-lived source-control tokens
- Exact tenant identifiers in every persistent self-hosted record
- Audit logging for policy, override, access, and configuration changes
- Optional AI-disabled mode
- Optional customer-provided AI endpoint or API key
- Repository content is treated as untrusted data, including against prompt injection

---

# 18. Primary risks and mitigations

## Risk 1: Another generic graph viewer

**Mitigation:** contracts, consumers, tests, and decisions are primary. The graph
is supporting evidence.

## Risk 2: False-positive fatigue

**Mitigation:** confidence classes, forbidden ChangeBench assertions, short PR
reports, appeal telemetry, and per-rule graduation.

## Risk 3: False-negative confidence

**Mitigation:** full-diff denominator, visible unknowns, measured scope coverage,
and prohibition against claiming general safety.

## Risk 4: Too many languages

**Mitigation:** complete TypeScript vertical support before another language.

## Risk 5: Framework behavior defeats generic parsing

**Mitigation:** first-party Framework Packs with explicit supported patterns,
confidence rules, and known limitations.

## Risk 6: Pull-request analysis is too slow

**Mitigation:** cached base graph, incremental parsing, symbol invalidation,
parallel workers, and early partial status.

Target performance goals, subject to benchmark revision:

- CLI startup below 1 second
- Small PR below 30 seconds
- Medium PR below 2 minutes
- Large PR below 5 minutes

## Risk 7: Installation friction

**Mitigation:** useful zero-configuration CLI and one-step Action. PostgreSQL and
Kubernetes cannot be mandatory for first use.

## Risk 8: Coding agents absorb the feature

**Mitigation:** ByteSmith becomes their deterministic evidence provider and
independent verification layer.

## Risk 9: Open source without monetization

**Mitigation:** useful free CLI/Action; paid future value may include cross-repo
history, organization policy, SAML/SCIM, audit, support, air-gapped releases,
enterprise packs, managed upgrades, and eventual Cloud.

## Risk 10: Optional enterprise features consume the roadmap

**Mitigation:** cross-repository and runtime features are customer-triggered and
not required for the first self-hosted release.

---

# 19. Customer-triggered features

## Cross-repository contracts

Build only when a design partner needs to connect producers and consumers across
repositories. Monorepo and single-repository multi-package support come first.

Potential relationships:

- API producer to client repositories
- Event producer to consumer repositories
- Shared package to applications
- Database owner to readers/writers
- Terraform outputs to dependent services
- Backend API to web and mobile clients

## Runtime confirmation

Build only when:

- Static analysis has a measured blind spot.
- A paying or committed partner already has compatible telemetry.
- The privacy and retention model is accepted.
- Runtime evidence materially improves a known rule.
- The integration has an identified operator and maintainer.

ByteSmith must not become a general observability platform.

---

# 20. Implementation artifact order

The schema precedes detailed module boundaries because every module produces or
consumes manifest fields.

Final order:

1. Product invariants
2. Result-state semantics
3. Evidence and finding vocabulary
4. Impact Manifest specification and JSON Schema
5. ChangeBench matcher semantics and JSON Schema
6. First 20–30 fixtures
7. Analyzer and Framework Pack interfaces
8. Module boundaries derived from manifest producers and consumers
9. Repository structure
10. Public TypeScript APIs
11. CLI command specification
12. GitHub Action protocol
13. MCP tool contracts
14. Self-hosted service contracts
15. Test, security, and release gates

An empty repository skeleton may exist earlier, but internal module APIs should
not be frozen before the manifest contract.

---

# 21. Detailed implementation phases

## Phase 0 — Normative specifications and ChangeBench

Deliver:

- Product invariants
- Result-state derivation
- Rule graduation and suspension
- Impact Manifest schema
- ChangeBench schema
- 20–30 labelled fixtures
- Dependency-free draft validation script
- Full Draft 2020-12 and semantic validator plan

Exit gate:

- All schemas validate.
- Every fixture has positive and negative expectations.
- Coverage buckets use the full-diff denominator.
- Analyzer failure and unsupported-file cases exist.

## Phase 1 — TypeScript analysis kernel

Deliver:

- Repository inventory
- TypeScript project discovery
- AST and type analysis
- Symbols, imports, exports, calls, and references
- Stable identifiers
- Evidence records
- Incremental cache
- SQLite state
- Normalized semantic output

Exit gate:

- Identical inputs produce identical normalized results.
- Incremental and clean full analysis agree.
- Phase 1 ChangeBench cases pass.

## Phase 2 — Contract engine

Implement in order:

1. TypeScript exports and signatures
2. OpenAPI
3. GraphQL
4. Prisma
5. Events
6. Environment and configuration contracts

Exit gate:

- Every contract change has compatibility classification and evidence.
- Unsupported or ambiguous changes become explicit unknowns.

## Phase 3 — Consumer and Impact Manifest engine

Deliver:

- Direct and transitive consumer linkage
- Evidence paths
- Confidence classification
- Impact Manifest serialization
- Semantic digest and canonicalization
- Schema and semantic validation

Exit gate:

- Local semantic output is reproducible.
- All references resolve.
- Result-state derivation cannot be overridden externally.

## Phase 4 — Test intelligence

Deliver:

- Jest, Vitest, and Playwright discovery
- Static test relationships
- Coverage ingestion
- Exact recommended commands
- Missing-test findings
- Historical comparison harness

Exit gate:

- Test-selection recall is measured in ChangeBench.
- No automatic test skipping is enabled.

## Phase 5 — CLI product

Deliver:

- `scan`
- `contracts`
- `impact`
- `test-plan`
- `context`
- `verify-impact`
- Human, JSON, and CI output formats
- Clear unsupported-scope reporting

Exit gate:

- Useful first run requires no account, database server, or AI key.

## Phase 6 — GitHub Action

Deliver:

- Exact commit binding
- PR check and comment
- Advisory-only default
- One updated comment rather than repeated noise
- Stale-result handling
- Appeals and waiver links/protocol
- Rule-specific opt-in enforcement

Exit gate:

- Rebase, force push, cancellation, duplicate events, and analyzer failure behave safely.
- No rule blocks until graduation conditions are met.

## Phase 7 — MCP and agent integration

Deliver the narrow tools listed earlier plus minimal evidence context packs.

Exit gate:

- Agents can consume evidence without receiving unrestricted source or database access.
- AI output cannot alter authoritative manifest fields.

## Phase 8 — Design-partner evaluation

Deliver:

- 3–5 real TypeScript partner evaluations
- Aggregate accuracy reports
- Regression fixtures from discovered failures
- Adversarial review if no natural discrepancy appears
- Usability and override telemetry

Exit gate:

- Blocking graduation requirements have evidence, not assumptions.

## Phase 9 — Self-hosted platform

Deliver:

- PostgreSQL persistence
- Multi-user organizations
- Historical manifests and graphs
- Policies
- RBAC
- Audit logs
- Docker Compose
- Helm charts
- Backup and restoration
- Local/optional AI
- Decision-oriented dashboard

Exit gate:

- Clean install, upgrade, rollback, backup, and restore are tested.
- Cross-tenant authorization tests pass.

## Later customer-triggered phases

- Cross-repository contracts
- Runtime confirmation
- Additional languages
- ByteSmith Cloud

---

# 22. Explicit non-goals for the current build

- COBOL modernization
- Automatic COBOL-to-Java transformation
- Autonomous source-code rewriting
- Generic repository chat
- Twenty-language support
- Mandatory cloud service
- Mandatory LLM
- A graph-first dashboard
- Automatic skipping of the complete test suite
- Unexplained aggregate risk scores
- OpenSearch, Kafka, or a dedicated graph database without benchmark evidence
- General-purpose observability ingestion

---

# 23. Specification package to materialize after approval

After final review, the consolidated decisions in this document will be split
into this implementation-facing package without changing their semantics:

```text
bytesmith-specification/
├── README.md
├── specs/
│   ├── product-invariants.md
│   ├── result-states.md
│   ├── rule-graduation.md
│   ├── impact-manifest.md
│   └── changebench.md
├── schemas/
│   ├── impact-types.schema.json
│   ├── impact-manifest.schema.json
│   └── changebench-case.schema.json
├── changebench/
│   └── fixtures/
│       ├── typescript-export-removed/
│       └── unsupported-file-counted/
└── scripts/
    └── validate-spec.mjs
```

The validation script must check JSON parsing, local schema references, fixture
identity, snapshot presence, and coverage sums without external services.
Production validation must additionally run complete JSON Schema Draft 2020-12
evaluation and every cross-field semantic invariant.

---

# 24. Final readiness criteria

Implementation may begin when the final reviewer confirms there is no blocker in:

- Product definition
- Full-diff coverage semantics
- Result-state derivation
- Evidence provenance
- Waiver and expiry behavior
- Rule graduation and suspension scope
- ChangeBench matcher semantics
- Artifact ordering
- Security boundaries
- Current deployment scope

Implementation beginning does not mean enabling blocking checks. Blocking remains
subject to the independent graduation gates.

---

# 25. Questions for the final reviewer

Please answer these directly:

1. Is “changed contract → consumers → tests → unknowns → Impact Manifest” a sufficiently coherent and differentiated product boundary?
2. Can any unsupported, ignored, generated, or failed analysis path still disappear from the full-diff denominator?
3. Can any analyzer failure still produce or appear as `pass`?
4. Is measured scope coverage clearly distinguished from unknowable real-world completeness?
5. Are appeals, waivers, expiry, and immutable original findings specified safely?
6. Is repository-first suspension correctly separated from organization/global suspension?
7. Do ChangeBench positive and negative matchers support meaningful precision and recall measurement?
8. Are the blocking-graduation criteria objective enough to enforce automatically?
9. Is the schema-first implementation order correct?
10. Are Framework Packs honestly treated as first-party work until external adoption exists?
11. Are MCP and optional AI positioned without weakening deterministic authority?
12. Are cross-repository, runtime, COBOL, and Cloud features correctly outside the current critical path?
13. Is there any remaining blocker that should prevent repository scaffolding and implementation from starting?

Please finish with one of these conclusions:

- **READY:** No blocker remains; implementation can begin.
- **READY WITH REQUIRED CHANGES:** List the precise changes that must be folded into the schemas during the first implementation phase.
- **NOT READY:** Identify the blocking contradiction or missing invariant.
