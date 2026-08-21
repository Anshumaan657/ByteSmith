# Phase 3A review checklist

## Review command

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

## Exit-gate evidence

- [x] Repository discovery accepts repository roots, nested directories, and
      file paths.
- [x] Non-repositories and bare repositories fail with structured error codes.
- [x] Base, head, tags, and direct object IDs resolve to full immutable commit
      identifiers.
- [x] Revision arguments are passed directly to Git without a shell.
- [x] Invalid, multiline, missing, and shell-like revisions fail safely.
- [x] Merge-base resolution returns exactly one commit or fails explicitly.
- [x] Branch movement and unexpected `HEAD` changes produce `stale_revision`.
- [x] Dirty and detached working-tree state is visible without changing bound
      revisions.
- [x] Repository identity prefers a normalized remote without credentials.
- [x] Local clones without a network remote derive the same identity from their
      committed root history.
- [x] Unborn repositories cannot claim stable history identity.
- [x] Git executes with prompts disabled and ambient `GIT_*` overrides removed.
- [x] Real temporary-repository tests cover the public Phase 3A API.

## Phase boundary

Phase 3A resolves repositories and revisions only. Changed-file acquisition,
rename and binary detection, coverage inventory, evidence, and canonical IR are
implemented in Phases 3B through 3E.

## Reviewer decision

- [ ] Approve Phase 3A and merge the pull request.
- [ ] Request changes before merge.
