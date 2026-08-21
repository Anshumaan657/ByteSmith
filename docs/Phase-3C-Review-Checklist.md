# Phase 3C review checklist

## Review command

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

## Exit-gate evidence

- [x] Every Phase 3B changed path is retained exactly once in the repository
      inventory.
- [x] The inventory is bound to the diff's exact base and head commit IDs.
- [x] Every file receives exactly one of `analyzed`, `partially_analyzed`,
      `unsupported`, or `intentionally_excluded`.
- [x] Coverage totals are derived from the classified files instead of supplied
      independently.
- [x] The four coverage buckets sum to the full Git changed-file denominator.
- [x] Rename and copy paths, object IDs, modes, binary state, similarity, and
      file kind survive classification unchanged.
- [x] Analyzer IDs are stable, unique, and deterministically ordered.
- [x] Analyzer coverage declarations are explicit claims for successfully
      processed paths; Phase 3C does not infer successful analysis from a file
      extension alone.
- [x] Partial coverage names at least one registered analyzer and includes a
      visible reason.
- [x] Generated, ignored, excluded, and explicitly unsupported rules retain the
      path and include a visible reason describing the decision.
- [x] Binary files, symbolic links, submodules, and unknown Git modes remain in
      the denominator as unsupported with a safety-specific reason.
- [x] Binary and special-file safety takes precedence over path policy.
- [x] Unmatched paths remain visible as unsupported rather than disappearing.
- [x] Exact-path, prefix, file-name, extension, and path-segment matchers use
      normalized repository path semantics.
- [x] Overlapping rules fail explicitly instead of relying on declaration
      order.
- [x] Invalid commits, mismatched totals, duplicate paths, invalid paths,
      inconsistent rename metadata, and invalid policy declarations fail
      closed.
- [x] Output ordering is deterministic even when input file order changes.
- [x] Unit tests and a real temporary-repository integration test cover the
      public Phase 3C API.

## Coverage-claim boundary

An analyzer coverage claim means that the named analyzer has successfully
processed every matched path. A caller must not register theoretical file-type
support as an analyzed claim. Incomplete processing must use an explicit
`partially_analyzed` rule and reason; absent support becomes `unsupported`.

## Phase boundary

Phase 3C creates the exhaustive revision-bound file inventory and coverage
arithmetic only. It does not create source evidence, stable evidence IDs,
analyzer-neutral IR, semantic changes, impacts, or manifest serialization.
Those responsibilities remain in Phases 3D and 3E.

## Reviewer decision

- [ ] Approve Phase 3C and merge the pull request.
- [ ] Request changes before merge.
