# Phase 3E review checklist

## Review command

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

## Exit-gate evidence

- [x] The production pipeline resolves repository identity, base revision, head
      revision, and merge base before reading source-control data.
- [x] The normalized Git diff, exhaustive inventory, evidence, canonical IR,
      and Impact Manifest share one exact base/head binding.
- [x] Every changed path remains visible in `scope.files` exactly once.
- [x] Deleted-file evidence binds to the base commit; all other changed-file
      evidence binds to the head commit.
- [x] Unsupported and partially analyzed files produce explicit canonical IR
      gaps and manifest unknowns instead of disappearing.
- [x] The pipeline rechecks named Git revisions after analysis and rejects an
      event whose expected base or head commit is stale.
- [x] Incremental reuse requires the same repository, exact revisions, merge
      base, and configuration digest.
- [x] Reused incremental inventory is reconstructed from the cached normalized
      diff and must agree byte-for-byte with the cached inventory.
- [x] Canonical IR is revalidated before an incremental snapshot is accepted.
- [x] Clean and incremental execution produce identical canonical semantic
      bytes and SHA-256 digests.
- [x] Runtime manifest identity, generation time, analyzer duration,
      signatures, and integrity metadata remain outside the semantic digest.
- [x] Semantic-set arrays use deterministic, code-point ordering; ordered
      arrays retain their declared order.
- [x] Manifest construction rejects mismatched repository/revision bindings,
      missing analyzer references, and inventory/IR denominator disagreement.
- [x] Production validation compiles the frozen Draft 2020-12 Impact Manifest
      and shared impact-type schemas directly from the authoritative schema
      directory.
- [x] Production semantic validation checks coverage arithmetic, identities,
      references, governance bindings, derived conclusion, and digest equality.
- [x] The Phase 3 projection of ChangeBench case `unsupported-file-counted`
      matches its exact coverage and required unknown expectation.
- [x] Integration tests create real temporary Git repositories and avoid
      host-specific paths, clocks, network access, or platform shell syntax.
- [x] The same aggregate quality gate runs locally and on Linux CI.

## Incremental boundary

Phase 3E reuses only immutable, revision-bound Phase 3 semantic snapshots. A
snapshot is not accepted merely because its branch name or path matches. Any
repository identity, commit, merge-base, configuration, inventory, or IR
disagreement forces a clean calculation or a visible error.

## Phase boundary

Phase 3E completes the deterministic Git-to-manifest substrate. The manifest
contains coverage evidence and explicit analysis gaps, but it intentionally has
no TypeScript contract changes, consumer impacts, test recommendations, or
policy findings yet. Those semantic outputs begin in Phases 4–6. SQLite,
user-facing CLI orchestration, and final manifest publication remain Phase 7.

## Reviewer decision

- [ ] Approve Phase 3E and merge the pull request.
- [ ] Request changes before merge.
