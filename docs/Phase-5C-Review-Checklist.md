# Phase 5C Review Checklist — TypeScript Structural and Package Rules

## Review outcome

Phase 5C completes the TypeScript compatibility-rule surface for Verify 0.1.
It converts exported interfaces, type aliases, classes, public fields,
source-level re-exports, and `package.json` export entries into deterministic
Phase 5A comparisons and manifest-ready advisory findings.

The public entry points are:

```ts
createTypeScriptStructuralRuleState(input)
createTypeScriptStructuralRuleDefinitions()
evaluateTypeScriptStructuralRules(input)
```

## Exact inputs and evidence

- Base/head compiler analyses must match the canonical IR repository and exact
  revisions.
- Supplied Phase 4 symbol matches are recomputed and rejected if they differ.
- Structural declarations reuse the conservative Phase 4 cross-revision symbol
  identity.
- Public field findings attach to the field symbol rather than only its parent
  interface or class.
- Parent contract evidence proves the complete base/head surface while member
  evidence proves the reported declaration.
- Every source-level re-export receives syntax evidence, including an unresolved
  target. An unresolved target is never promoted to a guessed relationship.
- Package export entries use their projected IR contract and manifest evidence.

## Versioned rules

Phase 5C adds five required advisory rules:

1. `typescript.structure.declarations@1.0.0`
2. `typescript.structure.fields@1.0.0`
3. `typescript.structure.type-aliases@1.0.0`
4. `typescript.package.re-exports@1.0.0`
5. `typescript.package.exports@1.0.0`

All five retain `defaultMode: advisory` and `blockingEligible: false`.

## Structural conclusions

### Declarations

- Removed exported interfaces, type aliases, and classes are breaking.
- Added exported structural declarations are compatible.
- Heritage and structural generic-parameter changes are potentially breaking.
- Multiple equally plausible declaration identities become required unknowns.

### Public fields

- Removed required public fields are breaking.
- Removed optional fields are potentially breaking.
- Added required fields are breaking.
- Added optional fields are compatible.
- Optional-to-required and required-to-optional changes are breaking because
  structural types may be created and consumed.
- Mutable-to-readonly is breaking; readonly-to-mutable is compatible.
- Incompatible primitive or union field changes are breaking.
- Directional changes on mutable fields are potentially breaking because the
  field can be read and written.
- Readonly fields use return-position covariance.
- Named, mapped, conditional, intersection, function, or deeply generic field
  changes that cannot be proven become explicit required unknowns.

### Type aliases

- Alias definitions are expanded with TypeScript's `InTypeAlias` representation
  instead of preserving only the alias name.
- Incomparable primitive/union aliases are breaking.
- Narrowing or widening aliases are potentially breaking because aliases may be
  used in input and output positions.
- Complex unproven alias changes become required unknowns.

## Package conclusions

### Source re-exports

- Removed package entry-point re-exports are breaking.
- Added re-exports are compatible.
- Target, path, or type-only changes are potentially breaking.
- Re-export logical identity is based on project, source entry point, and public
  export name.

### Export maps

- Removed subpath/condition entries are breaking.
- Added entries are compatible.
- A changed target is potentially breaking.
- A target changed to `null` is breaking.
- Package identity, subpath, and ordered conditions define the comparison key.

## Determinism and containment

- Structural, member, re-export, and export-map artifacts are canonically
  ordered.
- Rule state and semantic output are identical across repeated execution.
- Duplicate identities remain unknown and are not selected by input order.
- All findings execute through the frozen Phase 5A registry boundary.
- Existing Phase 5B callable behavior remains separate and unchanged.

## Automated verification

The focused suite proves:

- Exported structural declaration removal and addition
- Required field removal and addition
- Optional field becoming required
- Readonly compatibility direction
- Mutable field type changes
- Expanded type-alias incompatibility
- Source re-export removal
- Export-map removal, addition, and target changes
- Explicit complex field unknowns
- Exact binding and supplied-match rejection
- Repeat-run state and semantic-result determinism
- Revision-correct evidence and advisory metadata
- Expected conclusions for `optional-field-made-required`,
  `typescript-export-removed`, and `package-export-removed`
- No structural finding for `safe-internal-change`

## Intentionally deferred

- OpenAPI discovery and compatibility (Phases 5D–5F)
- Consumer linkage and test intelligence (Phase 6)
- Unified final manifest policies and CLI presentation (Phase 7)

## Reviewer commands

```bash
cd '/Users/anshumaansharma0404gmail.com/Desktop/ByteSmith'
corepack pnpm install --frozen-lockfile
corepack pnpm check
git diff --check
git status --short --branch
```

## Exit decision

Approve Phase 5C only when the complete workspace gate passes, structural and
package conclusions retain revision-correct evidence, field changes point to
the actual member, unresolved exports remain visible without guessed targets,
complex types become explicit unknowns, and every rule remains advisory and
ineligible for blocking.
