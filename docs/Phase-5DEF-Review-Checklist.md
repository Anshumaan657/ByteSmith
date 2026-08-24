# Phase 5D–5F Review Checklist — OpenAPI Contracts

## Review scope

This combined delivery completes the OpenAPI half of Phase 5 in one coherent
execution path. It contains three separately reviewable sections but is intended
to be committed and merged once.

## Phase 5D — Discovery and canonical contracts

- [x] Discover repository-owned `openapi`, `swagger`, and `.openapi` JSON/YAML
  documents without following symlinks or scanning dependency/Git directories.
- [x] Parse JSON and YAML deterministically with bounded YAML alias expansion.
- [x] Accept OpenAPI 3.0.x and 3.1.x and expose every other version as a required
  analyzer gap.
- [x] Resolve document-local JSON Pointer references.
- [x] Preserve external, unresolved, and recursive references as explicit gaps.
- [x] Extract routes, HTTP methods, operation IDs, parameters, request bodies,
  responses, component schemas, and inline request/response schemas.
- [x] Preserve unsupported schema composition instead of flattening or guessing.
- [x] Project files, operations, schemas, evidence, and gaps into canonical IR
  bound to the exact repository, base revision, and head revision.
- [x] Use stable semantic IDs and deterministic collection ordering.

## Phase 5E — Route and operation rules

- [x] Report a removed route as breaking.
- [x] Report a removed HTTP method on a retained route as breaking without
  duplicating a route-removal finding.
- [x] Report a newly required path/query/header/cookie parameter as breaking.
- [x] Report an added optional parameter as compatible.
- [x] Report optional-to-required and parameter-schema changes as breaking.
- [x] Report a newly required request body, optional-to-required request body,
  and removed accepted request media type as breaking.
- [x] Attach deterministic base/head evidence required by each conclusion.

## Phase 5F — Schema rules and integration

- [x] Treat component schemas and inline request/response payload schemas as
  first-class contracts.
- [x] Report schema and field removal as breaking.
- [x] Report required field addition as breaking and optional addition as
  compatible.
- [x] Report field type, format, and nullability changes as breaking.
- [x] Report optional fields made required as breaking.
- [x] Report removed enum values as breaking.
- [x] Execute all OpenAPI capabilities through one nine-rule Phase 5A registry.
- [x] Keep every rule required, versioned, advisory-only, and ineligible for
  blocking.
- [x] Convert unsupported and ambiguous input into required unknowns.
- [x] Reject stale or reversed revision analyses.
- [x] Verify repeat-run canonical IR and semantic digest equality.
- [x] Exercise both OpenAPI ChangeBench fixtures with no unexpected changes and
  100% preliminary contract-change precision (above the 95% gate).

## Validation commands

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

## Expected review result

- All repository tests, type checks, lint checks, formatting checks, workspace
  checks, frozen schemas, and ChangeBench fixtures pass.
- OpenAPI inputs never require network access.
- Unsupported behavior remains visible and cannot produce a clean result.
- Phase 5 is complete after this branch is approved and merged.
