# Supported patterns in Verify 0.1

ByteSmith supports Git repositories and monorepos containing TypeScript or
JavaScript projects described by `tsconfig.json`/`jsconfig.json`, plus OpenAPI
3.0 and 3.1 JSON or YAML documents.

## TypeScript and JavaScript

- npm, pnpm, and Yarn workspace layouts
- ESM imports/exports, CommonJS requires, re-exports, and package export maps
- functions, methods, interfaces, fields, type aliases, classes, parameters,
  overloads, return types, and basic generic constraints
- direct calls/references/imports and bounded transitive consumer paths
- TypeScript path aliases and project references

## OpenAPI

- repository-owned OpenAPI 3.0 and 3.1 documents
- routes, methods, parameters, request bodies, response bodies, object fields,
  requiredness, primitive types, and enum contraction
- local JSON Pointer references and narrow static `fetch`/HTTP-client calls

## Tests

- statically discoverable Jest and Vitest projects, files, and literal names
- repository-owned runnable commands
- authoritative import/reference/call linkage, with clearly labeled low-
  confidence naming and directory conventions

Every result is bound to immutable Git revisions and evidence. A changed path
that is not supported remains in coverage as partial, unsupported, or excluded
with a reason.
