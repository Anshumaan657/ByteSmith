# Phase 4B Review Checklist — Compiler Host, Parsing, and Module Resolution

## Review outcome

Phase 4B adds the revision-bound TypeScript Compiler API layer used by the
remaining semantic-analyzer slices. It converts compiler behavior into stable,
repository-relative diagnostics, module references, and explicit analysis gaps.

The public entry point is `createTypeScriptCompilerSession`. It accepts the
stable repository identity, an exact 40- or 64-character Git object ID, and
either a Phase 4A discovery result or the inputs needed to create one.

## Implemented scope

- Build one TypeScript `Program` for every discovered `tsconfig.json` or
  `jsconfig.json`, in deterministic project order.
- Restrict configured roots to Phase 4A's repository-owned source-file list.
- Bind every serialized diagnostic, reference, and gap to the repository ID,
  exact revision, and owning project.
- Normalize paths and compiler messages so serialized output never contains the
  host repository's absolute path.
- Capture configuration, option, global, syntactic, and semantic diagnostics.
- Discover static ESM imports, side-effect imports, re-exports, TypeScript
  `import = require`, and CommonJS `require` calls.
- Classify Node.js built-ins and installed packages as external dependencies.
- Resolve repository modules, TypeScript `paths` aliases, and linked workspace
  paths through the TypeScript module resolver and filesystem real paths.
- Retain unresolved static modules as required `unresolved_module` gaps.
- Retain literal and computed dynamic imports as required `dynamic_import` gaps;
  no static relationship is guessed.
- Convert parser, type-checker, and compiler-configuration errors into required
  gaps, while preserving the original normalized diagnostic.
- Expose runtime `Program` objects only through `getProgram`; they are excluded
  from the deterministic serializable analysis result.
- Pin the analyzer to TypeScript 6 and silence only its `baseUrl` migration gate
  so supported alias configurations continue to resolve during this pinned
  compiler version.

## Determinism and safety checks

- Repeating a compiler session over the same revision produces deeply equal
  analysis output.
- Changing the exact revision changes the revision-bound result.
- Symbolic refs such as `HEAD` are rejected.
- Discovery results from a different repository identity are rejected.
- Stable IDs include the repository, revision, project, location, and semantic
  content relevant to each record.
- Records are deduplicated by stable ID and sorted by normalized location.
- An error or required gap makes the affected project and aggregate analysis
  `incomplete`; it can never produce a clean result.

## Automated fixture coverage

- ESM type import and re-export
- TypeScript `import = require`
- CommonJS static `require`
- Node.js built-in external-module classification
- TypeScript path aliases using the production ChangeBench fixture
- Unresolved module behavior
- Computed dynamic-import behavior and required wording
- Syntax failure and type-check failure propagation
- Exact-revision and repository-identity validation
- Repeated-run determinism and absolute-path redaction

## Intentionally deferred

The following work belongs to later approved slices and is not part of Phase
4B:

- Symbol, declaration, export-surface, and public-signature IR (Phase 4C)
- Direct symbol references, call edges, and cross-revision symbol matching
  (Phase 4D)
- Analyzer crash/timeout containment, resource limits, incremental/clean
  agreement, canonical manifest projection, and performance gates (Phase 4E)

## Reviewer commands

```bash
cd '/Users/anshumaansharma0404gmail.com/Desktop/ByteSmith'
corepack pnpm install --frozen-lockfile
corepack pnpm check
git diff --check
git status --short --branch
```

## Exit decision

Approve Phase 4B only when the full repository check passes and the review
confirms that unresolved or dynamic module behavior stays explicit instead of
becoming a guessed relationship.
