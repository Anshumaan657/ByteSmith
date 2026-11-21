# ByteSmith execution flow

This document describes the real execution paths in the repository, using the
current source tree as the authority. It is intended to make code review and
interview demonstrations easier: it answers **what calls what**, in what order,
and where to make a change safely.

## 1. Product flow in one view

```text
Developer changes a Git repository
        |
        v
CLI or GitHub Action supplies exact base/head revisions
        |
        v
analysis-engine resolves Git identity + merge base + complete changed-file inventory
        |
        +--> TypeScript/JavaScript analyzer (when source files changed)
        +--> OpenAPI analyzer (when OpenAPI files changed)
        +--> Consumer analysis and Jest/Vitest test discovery
        |
        v
Canonical IR + revision-bound evidence
        |
        v
Impact Manifest (changes, consumers, tests, gaps, unknowns, conclusion)
        |
        +--> Terminal/JSON CLI report and optional SQLite cache
        +--> One advisory GitHub pull-request comment
```

The analyzers do not guess. If ByteSmith cannot prove a relationship or safely
analyze a construct, it records an explicit unknown or coverage gap.

## 2. Local CLI path

The CLI entry point is [`apps/cli/src/index.ts`](apps/cli/src/index.ts).

1. `runCli()` receives arguments from the shell.
2. [`parseArguments()`](apps/cli/src/arguments.ts) checks the command and
   options.
3. [`executeCommand()`](apps/cli/src/commands.ts) dispatches to `init`,
   `doctor`, `analyze`, `contracts`, `test-plan`, `verify-impact`, or
   `benchmark`.
4. `analyze` calls `analyzeRepository()` from
   [`packages/analysis-engine/src/engine.ts`](packages/analysis-engine/src/engine.ts).
5. The resulting Impact Manifest is rendered by
   [`apps/cli/src/reporting.ts`](apps/cli/src/reporting.ts) as terminal text or
   JSON; [`manifest-io.ts`](apps/cli/src/manifest-io.ts) writes requested files.

The normal interview command is conceptually:

```bash
corepack pnpm --filter bytesmith exec bytesmith analyze \
  --repository /path/to/demo-repository --base <base-commit> --head <head-commit>
```

## 3. Shared analysis-engine path

`analyzeRepository()` is the orchestration boundary. Both the CLI and the
GitHub Action use it, so they produce the same semantic result for the same
repository, revisions, and configuration.

1. [`config.ts`](packages/analysis-engine/src/config.ts) loads and normalizes
   `.bytesmith/config.json`, including enabled analyzers and resource limits.
2. [`vcs-git`](packages/vcs-git/src/) resolves the repository identity, exact
   base/head commits, and merge base. It rejects stale or ambiguous revisions.
3. [`runPhase3Pipeline()`](packages/impact-manifest/src/pipeline.ts) reads the
   exact commit diff and calls `repository-inventory` to put every changed file
   into the coverage denominator: analyzed, partially analyzed, unsupported, or
   intentionally excluded.
4. `vcs-git` materializes isolated archive snapshots for the merge base and
   head. The working tree is not used as analysis input.
5. `analyzeFamilies()` in `analysis-engine` checks inventory claims before
   running an analyzer:
   - `contracts-typescript` runs only for changed TS/JS files.
   - `contracts-openapi` runs only for changed OpenAPI files.
   - No matching source means the analyzer is `not_applicable`, rather than a
     false error. This is important for documentation-only pull requests.
6. Each analyzer emits Canonical IR records and revision-bound evidence.
   TypeScript rules run from `callable-rules.ts` and `structural-rules.ts`;
   OpenAPI rules run from `packages/contracts-openapi/src/rules.ts`.
7. [`consumer-analysis`](packages/consumer-analysis/src/) maps changed contracts
   to direct and bounded transitive consumers. It never invents a relationship.
8. [`test-intelligence`](packages/test-intelligence/src/) statically discovers
   Jest/Vitest projects, recommends tests linked by evidence, and reports test
   gaps where supported evidence is absent.
9. [`impact-manifest`](packages/impact-manifest/src/) assembles the one final
   manifest. [`manifest-validator`](packages/manifest-validator/src/) validates
   its schema, evidence closure, semantic rules, and conclusion.
10. [`storage-sqlite`](packages/storage-sqlite/src/) stores valid immutable
    manifests and exact-input cache entries. A corrupt entry becomes a visible
    cache miss; it is never trusted.

## 4. GitHub Action path

The Action metadata is [`apps/github-action/action.yml`](apps/github-action/action.yml),
which starts the committed bundle at `dist/bundle/index.js` on Node 24.

1. [`apps/github-action/src/index.ts`](apps/github-action/src/index.ts)
   validates the GitHub environment, event payload, non-shallow checkout, and
   clean working tree.
2. [`context.ts`](apps/github-action/src/context.ts) obtains the authoritative
   pull-request base, head, and merge-base revisions from the event.
3. [`analysis.ts`](apps/github-action/src/analysis.ts) calls the same
   `analyzeRepository()` path used by the CLI and rejects a result whose
   revisions do not match the event.
4. [`report.ts`](apps/github-action/src/report.ts) renders an evidence-linked
   Markdown report and updates one stable pull-request comment. When GitHub
   permissions do not allow a comment, it writes to the job summary instead.
5. The Action is advisory in Verify 0.1: it reports `pass`, `warn`,
   `incomplete`, or `error`, but does not block a merge.

## 5. Benchmark and release-audit path

1. `bytesmith benchmark` enters [`apps/cli/src/benchmark.ts`](apps/cli/src/benchmark.ts).
2. It loads ChangeBench fixtures from `changebench/fixtures/`, materializes
   deterministic temporary Git repositories, and calls the shared engine for
   every repeat.
3. [`packages/changebench`](packages/changebench/src/) compares actual manifests
   with expected findings, measures precision/recall/determinism/crashes/time/
   memory, and calculates release gates.
4. `corepack pnpm release:audit` first runs the normal quality gate, then
   [`scripts/release-audit.mjs`](scripts/release-audit.mjs) combines the
   benchmark result with `validation/portfolio/` and `validation/usability/`.
5. It writes the machine-readable `validation/release-audit.json` report. The
   report fails closed until automated thresholds, five real repositories, and
   five independent developer evaluations all pass.

## 6. Where changes are being made right now

This change adds only this `Flow.md` and `Decision.md`; it does not modify a
runtime path.

The most recent runtime work already in the project is Phase 9E release-audit
support (`scripts/release-audit.mjs`, its schema/ledger files, and the
deterministic benchmark repository identity in `apps/cli/src/benchmark.ts`).
The audit currently reports the real release state rather than masking it:
external evidence is pending, and the measured accuracy thresholds still need
improvement before a public `v0.1.0` release.

## 7. Safe places to extend the product

- Add a language: implement a new analyzer package that consumes exact
  snapshots and emits the existing Canonical IR/evidence shapes.
- Add rules: add versioned advisory rules within the owning analyzer package and
  add ChangeBench fixtures before claiming support.
- Add report fields: extend the Impact Manifest schema and semantic validator
  first, then update CLI and Action renderers together.
- Add Python: keep the shared Git, IR, consumer, manifest, CLI, Action, and
  storage layers; add a Python-specific analyzer and pytest adapter rather than
  rewriting the TypeScript project.
