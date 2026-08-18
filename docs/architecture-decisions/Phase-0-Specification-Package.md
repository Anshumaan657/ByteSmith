# ByteSmith Phase 0 specification package

## Status

This package is the review candidate for the Phase 0 semantic and schema freeze.
It is intentionally independent of CLI, GitHub Action, MCP, and Self-Hosted
presentation code.

## Normative documents

- `specs/product-invariants.md`
- `specs/result-states.md`
- `specs/vocabularies.md`
- `specs/impact-manifest.md`
- `specs/changebench.md`
- `specs/rule-graduation.md`
- `specs/canonicalization.md`
- `specs/semantic-validation.md`
- `specs/interface-reporting.md`

## Machine-readable contracts

- `schemas/impact-types.schema.json`
- `schemas/impact-manifest.schema.json`
- `schemas/changebench-case.schema.json`

All schemas declare JSON Schema Draft 2020-12 and are compiled in strict mode by
Ajv’s 2020 implementation. Conditional `required` constraints intentionally
refer to properties declared by their parent object schema.

## Prototypes and tests

`scripts/lib/` contains non-public Phase 0 reference prototypes for result-state
derivation, canonicalization, semantic validation, governance lifecycles, and
ChangeBench exhaustive matching. They freeze behavior, not production package
boundaries.

Run:

```bash
pnpm install --frozen-lockfile
pnpm phase0:check
```

The check compiles all schemas, validates every ChangeBench case, checks required
specifications and ADRs, and runs automated result-state, canonicalization,
semantic-validation, appeal, waiver, and unexpected-result tests.
