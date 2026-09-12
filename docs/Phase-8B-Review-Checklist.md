# Phase 8B review checklist — exact pull-request context

## Delivered

- [x] Pull-request number, base, head, repository, and fork status are parsed from the event payload.
- [x] Base and head must be full immutable commit identifiers.
- [x] Optional revision inputs must equal the event payload exactly.
- [x] Both commits and their unique merge base are resolved by the shared Git adapter.
- [x] The checked-out repository HEAD must equal the pull-request head.
- [x] Shallow, dirty, malformed, missing, and stale inputs fail explicitly.

## Verification

- [x] Same-repository pull requests expose exact base, head, and merge-base values.
- [x] Stale input overrides are rejected before analysis.
- [x] Existing startup, shallow-clone, and invalid-payload tests remain green.
