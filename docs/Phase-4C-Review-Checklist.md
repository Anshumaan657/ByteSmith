# Phase 4C Review Checklist — Symbols, Exports, and Public Signatures

## Review outcome

Phase 4C extends each revision-bound compiler session with deterministic,
analyzer-neutral records for supported TypeScript and JavaScript declarations,
module exports, package exports, and public contract signatures.

The resulting structures contain no TypeScript Compiler API objects and no
host-specific paths. Runtime `Program` access remains isolated behind the Phase
4B session API.

## Implemented symbol model

- Top-level function declarations
- Callable arrow/function variables
- Non-callable variables
- Interfaces and their fields and methods
- Type aliases
- Classes and their fields and methods
- Public, protected, and private visibility
- Static, readonly, optional, ambient, and default-export attributes
- Parent-qualified member names and stable parent references
- Exact repository-relative declaration ranges
- Public reachability propagated from exported interfaces and classes to their
  public members without exposing private or protected members

## Implemented contract model

- Function and method overload signatures
- Generic type parameters, constraints, and defaults
- Parameter names, semantic types, optionality, and rest status
- Semantic return types, including inferred JavaScript/JSDoc types
- Interface and class member shapes
- Field type, optionality, readonly status, visibility, and static status
- Interface/class heritage types
- Type-alias targets
- Variable semantic types
- Class construction signatures
- Canonical semantic signature serialization
- Stable semantic fingerprints that exclude implementation bodies

Contract IDs remain bound to a repository, exact revision, project, and symbol.
Fingerprints intentionally cover only the canonical public shape so Phase 5 can
distinguish compatibility changes from safe body-only edits.

## Export surfaces

- Local named exports
- Default exports
- Renamed and cross-file re-exports
- Type-only classification
- Target declaration path and symbol linkage when resolved
- Owning workspace-package linkage
- `package.json` root/subpath exports
- Conditional and array-fallback package-export targets
- Legacy `types` and `main` package entry points when `exports` is absent
- Required gaps for package-export target shapes that cannot be modeled safely

## Safety behavior

- Exported destructuring declarations that cannot be represented safely become
  required `unsupported_signature` gaps.
- Public computed member names that cannot be resolved statically become
  required gaps.
- Public call, construct, and index signatures that are outside this frozen
  structural model become required gaps instead of guessed contracts.
- Any required signature gap makes the aggregate compiler analysis incomplete.
- Type-check, parse, dynamic-import, and unresolved-module safety behavior from
  Phase 4B remains unchanged.

## ChangeBench verification

Automated tests use the production ChangeBench snapshots to prove that:

- A safe implementation-only change preserves its signature fingerprint.
- Adding a required parameter changes the function fingerprint and retains the
  parameter as required.
- Adding an optional parameter retains explicit optionality.
- An exported return-type change produces a different semantic return type.
- Making an optional interface field required is visible in the shape.
- Removing a package-barrel export changes the exact exported-name set.

Additional fixtures cover TypeScript functions, interfaces, aliases, classes,
members, generics, rest parameters, re-exports, conditional package exports,
private-member reachability, JavaScript/JSDoc inference, and unsupported public
index signatures.

## Intentionally deferred

- Direct import/reference/call relationships (Phase 4D)
- Base/head symbol equivalence and safe cross-revision matching (Phase 4D)
- Contract compatibility conclusions such as breaking or compatible (Phase 5)
- Evidence and canonical IR projection, failure containment, resource limits,
  incremental agreement, and performance gates (Phase 4E)

Phase 4C records the facts needed for later decisions; it does not issue a
breaking-change verdict.

## Reviewer commands

```bash
cd '/Users/anshumaansharma0404gmail.com/Desktop/ByteSmith'
corepack pnpm install --frozen-lockfile
corepack pnpm check
git diff --check
git status --short --branch
```

## Exit decision

Approve Phase 4C only when the repository quality gate passes and review
confirms that contract fingerprints change for public semantic edits, remain
stable for implementation-only edits, and never conceal unsupported public
shapes.
