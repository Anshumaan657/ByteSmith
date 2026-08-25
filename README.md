# ByteSmith

**Prove the impact before you merge.**

ByteSmith Verify 0.1 is a local, advisory change-impact verifier for TypeScript
and JavaScript repositories. It connects changed TypeScript or OpenAPI
contracts to affected consumers and relevant Jest or Vitest tests, then emits
deterministic evidence in the terminal, an Impact Manifest, and a GitHub pull
request report.

## MVP hypothesis

ByteSmith Verify exists to answer one question:

> Will developers use a tool that detects a changed contract, identifies
> affected consumers, recommends relevant tests, and presents the evidence
> directly in their pull request?

The MVP works offline, requires no account, cloud service, or AI key, stores
local state in SQLite and the filesystem, and never blocks a pull request.

## Current status

- Phase 0 safety specifications, schemas, ADRs, fixtures, and validation are
  complete.
- Phases 1–3 establish the MVP workspace, ChangeBench suite, exact Git inputs,
  evidence, and canonical IR.
- Phase 4 provides deterministic TypeScript/JavaScript semantic analysis.
- Phase 5 TypeScript and OpenAPI contract rules are complete.
- Phase 6 direct, workspace, OpenAPI, and bounded transitive consumer linkage is
  under review; Jest/Vitest intelligence remains next.
- CLI, storage, and GitHub Action work remain intentionally deferred to Phases
  7–8.

## Requirements

- Node.js 22.13 or newer
- Corepack
- pnpm 11.19.0, invoked through Corepack
- Git

## Development

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

Individual checks:

```bash
corepack pnpm validate:workspace
corepack pnpm phase0:check
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
```

## Active MVP structure

```text
apps/
  cli/                    Local command-line interface
  github-action/          Advisory pull-request integration
packages/
  impact-types/           Shared result and coverage types
  evidence/               Revision-bound evidence and provenance
  ir/                     Analyzer-neutral intermediate representation
  canonicalization/       Stable identity and semantic digest
  impact-manifest/        Canonical result construction
  manifest-validator/     Schema and semantic validation
  vcs-git/                Exact-revision Git access
  repository-inventory/   Exhaustive changed-file denominator
  analyzer-sdk/           Analyzer outcomes and capabilities
  contracts-typescript/   TypeScript/JavaScript semantic analysis
  contracts-openapi/      OpenAPI compatibility analysis
  consumer-analysis/      Bounded consumer relationships
  test-intelligence/      Jest/Vitest recommendations and gaps
  storage-sqlite/         Embedded local persistence
  changebench/            Deterministic benchmark runner
changebench/              Versioned benchmark fixtures and results
schemas/                  Frozen machine-readable contracts
specs/                    Normative product semantics
scripts/                  Validation prototypes and repository checks
docs/                     MVP scope, architecture, roadmap, and ADRs
```

## Documentation

- [MVP scope](docs/MVP-SCOPE.md)
- [MVP architecture](docs/MVP-ARCHITECTURE.md)
- [Phase-by-phase roadmap](docs/ByteSmith-MVP-Implementation-Roadmap.md)
- [Phase 0 specification package](docs/architecture-decisions/Phase-0-Specification-Package.md)

Features outside Verify 0.1 are documented as deferred rather than represented
by empty implementation folders.
