# Phase 3B review checklist

## Review command

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

## Exit-gate evidence

- [x] Diff acquisition accepts only exact, immutable commit identifiers.
- [x] Comparison diffs use the Phase 3A merge base and resolved head commit.
- [x] Base and head references are checked for movement before and after a
      comparison diff is acquired.
- [x] Added, modified, deleted, renamed, copied, and type-changed paths have
      explicit normalized change types.
- [x] Regular, executable, symbolic-link, submodule, and unknown Git modes have
      explicit file-kind representations.
- [x] Rename and copy records retain the previous path and Git similarity.
- [x] Binary files are detected through Git numstat without reading working-tree
      content.
- [x] Repository paths are NFC-normalized, deterministically ordered, and
      protected from absolute paths, traversal, ambiguous separators, and
      normalization collisions.
- [x] Raw and numstat output is parsed as strict UTF-8 from NUL-delimited bytes,
      preserving spaces, tabs, quotes, and newlines in valid Git paths.
- [x] Raw metadata, numstat metadata, object IDs, modes, and status shapes must
      agree or the diff fails explicitly.
- [x] Unsupported statuses, malformed output, duplicate paths, invalid UTF-8,
      Git failures, and output-limit failures cannot produce a partial success.
- [x] Fixed Git options disable external diff drivers and text conversion while
      making rename, copy, submodule, and diff-algorithm behavior reproducible.
- [x] Uncommitted working-tree changes do not alter an exact-commit diff.
- [x] Real temporary-repository tests cover every public Phase 3B behavior.

## Phase boundary

Phase 3B produces a deterministic changed-file list bound to exact commits. It
does not classify coverage, decide which paths are analyzable, create evidence
records, or emit canonical analyzer IR. Those responsibilities remain in
Phases 3C through 3E.

## Reviewer decision

- [ ] Approve Phase 3B and merge the pull request.
- [ ] Request changes before merge.
