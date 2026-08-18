# ByteSmith

**Prove the impact before you merge.**

ByteSmith is a local-first verification engine that connects changed contracts
to affected consumers and required tests, then produces reproducible,
appealable, and auditable evidence before merge.

## Current status

Phase 0 defines the normative Impact Manifest, result states, governance rules,
canonicalization, semantic validation, and ChangeBench safety fixtures. Product
interfaces and analyzer packages remain intentionally unimplemented until these
contracts are reviewed and frozen.

## Validate Phase 0

Requirements: Node.js 22+ and pnpm 11.

```bash
pnpm install --frozen-lockfile
pnpm phase0:check
```

Normative specifications live in `specs/`, schemas in `schemas/`, correction-
focused fixtures in `changebench/fixtures/`, and accepted decisions in
`docs/architecture-decisions/`.
