# ByteSmith CLI workflow

ByteSmith operates locally against explicit Git commits. It does not require an
account, network service, AI key, or working-tree checkout mutation.

## Initialize and diagnose

```bash
corepack pnpm --filter bytesmith exec bytesmith init --repository /path/to/repository
corepack pnpm --filter bytesmith exec bytesmith doctor --repository /path/to/repository --no-color
```

`init` creates `.bytesmith/config.json` and the SQLite database. Re-running it
preserves an existing configuration. `doctor` checks Node, Git and HEAD,
configuration, SQLite integrity, enabled analyzers, and Jest/Vitest discovery.

## Analyze exact revisions

```bash
corepack pnpm --filter bytesmith exec bytesmith analyze \
  --repository /path/to/repository \
  --base origin/main \
  --head HEAD \
  --format json \
  --output reports/impact.json
```

The output is one validated, revision-bound Impact Manifest. Use `--no-cache`
to force recomputation and `--database PATH` or `--config PATH` for explicit
local overrides.

## Inspect and verify

```bash
corepack pnpm --filter bytesmith exec bytesmith contracts --manifest reports/impact.json --no-color
corepack pnpm --filter bytesmith exec bytesmith test-plan --manifest reports/impact.json --no-color
corepack pnpm --filter bytesmith exec bytesmith verify-impact --repository /path/to/repository --manifest reports/impact.json
```

Focused commands never guess a latest run. Verification rejects an invalid
digest, unsupported schema, different repository, missing commit, or a manifest
whose head no longer matches the repository's current `HEAD`.

## Benchmark

```bash
corepack pnpm --filter bytesmith exec bytesmith benchmark --case relevant-test-selected --repeat 2
```

The benchmark materializes deterministic temporary Git repositories and reports
precision, test recall, determinism, crash rate, and pass/fail quality gates.

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | pass |
| 1 | warn |
| 2 | fail |
| 3 | incomplete |
| 4 | execution or stale-revision error |
| 5 | invalid configuration, manifest, or input |
| 6 | unsupported schema version |
