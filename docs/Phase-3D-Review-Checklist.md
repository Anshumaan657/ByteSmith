# Phase 3D review checklist

## Review command

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

## Exit-gate evidence

- [x] Shared source-location, producer, evidence, component, confidence,
      severity, and blocking-relevance types follow the frozen Phase 0 schema
      vocabulary.
- [x] Repository paths are relative, NFC-normalized, and traversal-safe.
- [x] Evidence repository IDs and producer IDs satisfy the stable ID contract.
- [x] Evidence accepts only full base or head Git object IDs from its comparison
      binding.
- [x] Source ranges use positive safe integers, complete coordinate pairs, and
      cannot end before they start.
- [x] Evidence records include kind, producer/version, exact location, and a
      non-empty human-readable summary.
- [x] Evidence IDs are SHA-256 identities of normalized semantic content and
      change when producer, location, kind, or summary changes.
- [x] Evidence collections are deterministically ordered and reject duplicate
      semantic records.
- [x] Canonical JSON normalizes strings and object keys to NFC, orders object
      keys by code point, preserves ordered arrays, and rejects non-JSON values,
      non-finite numbers, and normalized-key collisions.
- [x] Analyzer-neutral IR represents files, symbols, contracts, relationships,
      tests, and explicit analysis gaps.
- [x] Every IR record is bound to the repository and either the exact base or
      exact head revision.
- [x] Every IR record references at least one existing evidence record from the
      same revision.
- [x] File, symbol, contract, relationship, test, gap, and evidence collections
      have unique IDs and deterministic ordering.
- [x] Symbols resolve to a same-revision file at the same path.
- [x] Contracts resolve to a same-revision file or symbol.
- [x] Relationship endpoints resolve and cannot cross revisions.
- [x] Authoritative files, symbols, contracts, relationships, and tests cannot
      rely only on heuristic evidence.
- [x] External IR validation rejects tampered IDs, locations, content,
      references, revisions, duplicates, and ordering.
- [x] A real temporary-repository integration test preserves the exact changed
      path denominator through Git diff, inventory, evidence, and file IR.

## Stable identity boundary

Stable IDs identify revision-bound semantic records; they are not random UUIDs
or runtime database keys. Record collections are semantic sets sorted by ID.
Arrays inside identity inputs remain ordered unless a factory explicitly
normalizes them as a semantic set.

## Phase boundary

Phase 3D creates and validates revision-bound evidence and canonical local IR.
It does not serialize an Impact Manifest, compute the manifest semantic digest,
persist IR, compare incremental and clean analysis, or run analyzer-specific
contract rules. Manifest integration and clean/incremental agreement remain in
Phase 3E; semantic analyzers begin in Phase 4.

## Reviewer decision

- [ ] Approve Phase 3D and merge the pull request.
- [ ] Request changes before merge.
