# Phase 4D Review Checklist — References, Calls, and Cross-Revision Identity

## Review outcome

Phase 4D turns Phase 4B module resolution and Phase 4C declarations into
authoritative direct relationships. It also provides conservative base/head
symbol matching so later rules can compare the same declaration across exact
revisions without relying on line numbers.

This slice records direct facts only. It does not traverse consumer graphs or
issue compatibility conclusions.

## Import-binding model

- Default imports
- Named and renamed imports
- Type-only imports
- Namespace imports
- TypeScript `import = require` bindings
- Linkage to the originating Phase 4B module-reference record
- Internal, external, unresolved, and dynamic resolution status
- Repository-relative target paths
- Exact Phase 4C target-symbol IDs when a supported declaration is resolved
- Cross-project target linkage for basic monorepos and path aliases

An internally resolved named/default import that cannot be linked to a
supported declaration produces a required `unresolved_symbol` gap. Namespace
and import-equals bindings retain their resolved module identity without
inventing a declaration-level target.

## Direct relationships

- Direct calls to functions and callable variables
- Constructor calls
- Method calls through property access
- Non-call symbol references
- Type-position references
- Exact source ranges for every use
- Exact source and target repository paths
- Phase 4C source and target symbol IDs when the use occurs inside a supported
  declaration
- File-scoped relationships for top-level uses such as test-file calls
- `authoritative` authority on Compiler API-resolved edges
- Stable relationship IDs, deduplication, and deterministic ordering

Imports and exports are not treated as calls. Import declarations are captured
through import bindings, while re-exports remain in the Phase 4C export model.

## Cross-revision identity

`matchTypeScriptSymbols(base, head)` requires two different exact revisions
from the same repository identity and returns:

- One-to-one symbol matches
- Stable logical symbol IDs
- Base and head symbol IDs
- Matching basis
- File-movement status
- Contract-signature change status
- Explicit added, removed, or ambiguous unmatched symbols

Matching proceeds conservatively:

1. Unique project, path, kind, and qualified-name identity
2. Unique kind and qualified-name identity for a declaration moved between
   files

Names are never changed or guessed to force a match. Renames remain an explicit
remove/add pair. When more than one moved candidate exists, every candidate is
marked ambiguous rather than selected heuristically.

## ChangeBench verification

Automated tests prove that:

- `checkoutTotal` directly calls the imported `calculateTax` symbol.
- A two-level consumer fixture contains only `renderProfile → getProfile` and
  `getProfile → loadUser` direct edges; Phase 4D does not synthesize a transitive
  edge.
- The unrelated admin consumer produces no false relationship.
- Top-level test calls retain file scope and an exact target.
- TypeScript path aliases preserve the correct import and call targets.
- Cross-project monorepo imports, references, constructors, and methods resolve
  to declarations owned by another TypeScript project.
- A changed function keeps its logical identity while its signature change is
  visible.
- Moving an unchanged symbol between files matches uniquely.
- Renamed and ambiguous symbols remain unmatched.
- Repeated matching is deterministic.

## Safety behavior

- Compiler-resolved repository symbols outside the supported declaration model
  become required gaps.
- External library and local parameter symbols are not misreported as missing
  repository declarations.
- Existing parse, type-check, module-resolution, dynamic-import, and unsupported
  signature gaps remain intact.
- Type-check failures may coexist with useful direct edges, but the aggregate
  analysis remains incomplete.
- Cross-revision matching rejects repository mismatches and identical-revision
  comparisons.

## Intentionally deferred

- Bounded transitive consumer-path traversal and relevance filtering (Phase 6)
- Jest/Vitest test discovery and recommendations (Phase 6)
- Breaking/compatible contract verdicts (Phase 5)
- Canonical evidence/IR projection, crash and timeout containment, resource
  limits, incremental/clean agreement, performance gates, and complete
  ChangeBench analyzer execution (Phase 4E)

## Reviewer commands

```bash
cd '/Users/anshumaansharma0404gmail.com/Desktop/ByteSmith'
corepack pnpm install --frozen-lockfile
corepack pnpm check
git diff --check
git status --short --branch
```

## Exit decision

Approve Phase 4D only when the full repository gate passes and review confirms
that every emitted edge is Compiler API-authoritative, transitive edges are not
silently synthesized, and ambiguous cross-revision identities remain explicit.
