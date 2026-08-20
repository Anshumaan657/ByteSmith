# ByteSmith Verify 0.1 MVP Scope

## Product hypothesis

ByteSmith Verify 0.1 tests one hypothesis:

> Developers will use a tool that detects a changed contract, identifies
> affected consumers, recommends relevant tests, and presents deterministic
> evidence directly in their pull request.

The MVP is a local TypeScript change-impact verifier delivered through the
`bytesmith` CLI and a non-blocking GitHub Action. It is not a smaller copy of
the planned enterprise platform.

## Included capabilities

### Safety contracts

- Versioned Impact Manifest schema
- `pass`, `warn`, `fail`, `incomplete`, and `error` result states
- Every changed file retained in the full-diff denominator
- Revision-bound evidence and provenance
- Explicit unknown and analysis-gap results
- Rule lifecycle, waiver, suspension, and appeal data types
- ChangeBench case schema with required and forbidden assertions
- Structural and cross-field semantic validation
- Deterministic canonicalization and semantic digest

The MVP is advisory. Ordinary impact produces `warn`, not a blocking failure.
Required analyzer failure can never produce `pass`.

### Supported inputs

- One local Git repository or monorepo
- Explicit base and head revisions
- Merge-base resolution
- Added, modified, deleted, and renamed files
- Binary and unsupported file classification
- TypeScript and JavaScript projects using `tsconfig.json`
- npm, pnpm, and Yarn workspace layouts
- TypeScript path aliases and basic package boundaries
- OpenAPI documents

### Supported analysis

- Imports and exports
- Functions and methods
- Interfaces and interface fields
- Type aliases and classes
- Public signatures
- Direct calls and direct references
- TypeScript package exports
- Direct consumers and bounded transitive paths
- Statically discoverable OpenAPI client references
- Jest and Vitest test recommendations
- Affected consumers for which no test was found

### Explicit unknowns

- Dynamic imports
- Reflection
- Complex dependency injection
- Generated code
- Unresolved modules
- Type-checking failures
- Unsupported changed files
- Truncated consumer traversal
- Analyzer crash, timeout, or incomplete required analysis

Unknowns remain visible and affect the final result according to the Phase 0
result-state rules.

### User interfaces

- Offline CLI with `init`, `doctor`, `analyze`, `contracts`, `test-plan`,
  `verify-impact`, and `benchmark`
- Terminal and JSON output
- Impact Manifest file output
- Embedded SQLite and local filesystem storage
- GitHub Action that updates one advisory pull-request report
- Exact-head binding and stale-result rejection
- Stable documented exit codes

## Deferred capabilities

The following are intentionally outside Verify 0.1 and have no active
implementation folders:

- Self-hosted web platform, API, dashboard, or worker service
- PostgreSQL, NATS, Valkey, containers, Helm, Kubernetes, or service telemetry
- MCP server or AI explanations
- GraphQL, Prisma, event, configuration, or infrastructure contracts
- Cross-repository analysis
- Multiple programming languages or COBOL
- Runtime/OpenTelemetry relationships
- Next.js, NestJS, or Playwright framework packs
- Coverage ingestion or historical-failure ranking
- Automatic fixes or automatic test generation
- Selective test skipping or execution orchestration
- Blocking pull-request checks
- Organization policies, RBAC, SSO, or audit-log UI
- Cloud hosting, object storage, or large graph visualization

These capabilities may be reconsidered only after the MVP hypothesis is tested.

## Definition of done

Verify 0.1 is complete when a developer can open a TypeScript pull request and
receive an advisory report that states:

1. What contract changed.
2. Which consumers are affected.
3. Which Jest or Vitest tests are recommended.
4. Which affected code has no test ByteSmith could find.
5. What ByteSmith could not analyze.
6. The evidence for every conclusion.

## Success criteria

### Correctness

- Every changed file appears in exactly one coverage category.
- Required analyzer failure never produces `pass`.
- Every contract, consumer, and test conclusion has evidence.
- Unsupported patterns appear as unknowns.
- Identical inputs and versions produce identical semantic output.
- All 20 MVP ChangeBench cases pass.

### Preliminary accuracy targets

- Contract-change precision: at least 95%
- Direct-consumer precision: at least 90%
- Test-selection recall: at least 80%
- Determinism: 100%
- Analyzer crashes on supported fixtures: 0%

These are advisory MVP targets. They do not qualify any rule for blocking.

### Performance targets on an M1 MacBook Air

- Small pull request: less than 30 seconds
- Medium pull request: less than 2 minutes
- Peak memory: preferably less than 3 GB
- Default parser concurrency: one worker

### Usability and repository validation

At least five developers must install and use ByteSmith without assistance and
identify at least one useful consumer or test. Validation must cover an ordinary
TypeScript repository, a monorepo, an API/backend repository, an OpenAPI
repository, and an older or inconsistent repository.
