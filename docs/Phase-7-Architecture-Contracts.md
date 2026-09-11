# Phase 7 architecture and contracts

Phase 7 uses one reusable analysis boundary. The CLI is an adapter, not an
analysis implementation.

## 1. Analysis engine

The package is `@bytesmith/analysis-engine` (`packages/analysis-engine`). It
owns configuration normalization and its digest, exact Git comparison and
snapshot lifecycle, analyzer orchestration, cancellation checks, shared test
and consumer analysis, final manifest assembly, validation through the storage
boundary, cache lookup, and final stale-reference checks. The future GitHub
Action consumes the same `analyzeRepository()` API.

`scopeIr` is intentionally distinct from analyzer IR. Scope IR contains one
revision-bound record per changed file from merge-base to head; TypeScript and
OpenAPI IR contain all discovered files, symbols, and contracts. Only scope IR
is used as the manifest coverage denominator.

## 2. Exact snapshots

`@bytesmith/vcs-git` exposes `materializeGitSnapshot()` and
`withGitSnapshots()`. They resolve an exact commit, run `git archive`, extract
into a private temporary directory, and never checkout or mutate the caller's
working tree. Every snapshot has an idempotent cleanup function. The engine
analyzes merge-base as the base snapshot and the resolved head as the head
snapshot, while the manifest retains the requested/resolved base, resolved
head, and merge-base comparison identity.

## 3. Configuration

The canonical location is `.bytesmith/config.json`. `bytesmith init` creates
it without overwriting an existing file. The file is strict JSON, schema
`1.0.0`, and is normalized before use. Defaults are applied only for omitted
fields; unknown properties, unsupported versions, invalid limits, disabled
analyzer claims, and malformed inventory policies are rejected.

The effective normalized document is hashed as the manifest
`configurationDigest`. It includes enabled analyzers and versions, inventory
policy, consumer limits, recommendation limits, cache behavior, and database
path. The JSON Schema is `schemas/bytesmith.config.schema.json`.

## 4. SQLite

`@bytesmith/storage-sqlite` uses Node's built-in `node:sqlite` driver. This is
an intentional Node `>=22.13.0` decision: it avoids native dependency
installation and keeps local Verify installation offline. The experimental
runtime warning is accepted and is not hidden. A forward-only, checksum-bound
migration creates immutable manifest runs and relational cache metadata. Every
persisted manifest is schema/semantic validated before the transaction commits.

An invalid cached JSON row, digest, identity, or manifest is deleted as a cache
miss and is never returned to callers. Database open, migration, or integrity
failures quarantine the database file as `*.corrupt.<timestamp>-<pid>` before
failing closed. Duplicate manifest IDs are immutable: identical content is
idempotent, divergent content is rejected.

## 5. Combined TypeScript/OpenAPI execution

Enabled TypeScript and OpenAPI contract analyzers run against the two exact
materialized snapshots in parallel. Each family evaluates its own rules and
produces family-owned changes and evidence. Consumer analysis then runs once
per available family; results are combined only after repository/revision
binding checks. Test discovery runs exactly once for the comparison, and one
recommendation pass consumes the combined consumer result and merged IR. No
family may perform a private second test-discovery or recommendation pass.

## 6. CLI contract

Commands are:

- `init` — create `.bytesmith/config.json` and the local SQLite database;
- `doctor` — validate configuration and report SQLite integrity;
- `analyze --base REV --head REV` — explicit exact comparison and validated
  Impact Manifest output;
- `contracts --manifest FILE`;
- `test-plan --manifest FILE`; and
- `verify-impact --manifest FILE`.

Focused commands require an explicit manifest; they never guess a latest run.
`analyze --format json` emits the validated Impact Manifest itself. Text output
is a projection of that manifest. `--output FILE`, `--no-color`, `--config`,
`--database`, and `--no-cache` are stable options. Errors always use the JSON
shape `{ "schemaVersion": "1.0.0", "error": { "code", "message" } }`.

Stable exit codes are:

| Code | Meaning |
| ---: | --- |
| 0 | pass |
| 1 | warn |
| 2 | fail |
| 3 | incomplete |
| 4 | error |
| 5 | invalid configuration/manifest/input |
| 6 | unsupported schema version |

The conclusion is never rewritten by a presentation adapter.

## 7. Cache identity

The cache key is SHA-256 over a canonical object containing repository ID,
resolved base, resolved head, merge-base, engine version, every enabled
analyzer ID/version, rule-set version, manifest schema version, analyzer-set
identity, and the complete effective configuration digest. A cache hit also
requires exact current ref checks and structural, semantic, identity, and
semantic-digest validation of the stored manifest. Corruption is observable as
`execution.cache: "corrupt"`, followed by recomputation; corrupted data is
not repaired in place.
