# Phase 5B Review Checklist — TypeScript Callable Rules

## Review outcome

Phase 5B adds the first production compatibility conclusions to ByteSmith. It
turns exported TypeScript function and method signatures from Phase 4 into
revision-bound contract artifacts, matches them through the Phase 5A engine,
and executes five versioned advisory rules.

The public entry points are:

```ts
createTypeScriptCallableRuleState(input)
createTypeScriptCallableRuleDefinitions()
evaluateTypeScriptCallableRules(input)
```

## Exact comparison binding

- Base and head analyses must match the canonical IR repository and exact Git
  revisions.
- Existing Phase 4 cross-revision symbol identities are reused when supplied
  and recomputed deterministically otherwise.
- Only exported `function_signature` contracts owned by public function or
  method symbols enter callable evaluation.
- Each artifact is linked to exactly one IR symbol and contract at the same
  revision and declaration location.
- Every compatibility result references authoritative contract evidence from
  its applicable base and/or head revision.
- Duplicate callable names remain ambiguous and are never selected by order.

## Versioned rules

Phase 5B registers five required, advisory-only rules:

1. `typescript.callable.identity@1.0.0`
2. `typescript.callable.overloads@1.0.0`
3. `typescript.callable.parameters@1.0.0`
4. `typescript.callable.generics@1.0.0`
5. `typescript.callable.returns@1.0.0`

Every finding retains its rule ID and version internally, projects to a valid
Impact Manifest change, and remains ineligible for blocking in Verify 0.1.

## Supported conclusions

### Callable identity and overloads

- Removed exported functions are breaking.
- Removed public methods on exported classes or interfaces are breaking.
- Removed overloads are breaking.
- Added overloads are compatible.
- Multiple equally plausible overload correspondences become required
  unknowns.

### Parameters and generics

- Added required parameters are breaking.
- Added optional or rest parameters are compatible.
- Removed parameters are breaking.
- Optional-to-required parameters are breaking.
- Required-to-optional parameters are compatible.
- Rest-to-fixed changes are breaking; fixed-to-rest changes are compatible.
- Parameter narrowing or incomparable primitive/union changes are breaking.
- Parameter widening is compatible.
- Required generic parameters and removed generic parameters are breaking.
- Narrowed or incompatible generic constraints are breaking.
- Widened generic constraints and defaulted generic parameters are compatible.
- Changed generic defaults are potentially breaking.

### Return and async contracts

- Return widening or incompatible primitive/union changes are breaking.
- Return narrowing is compatible.
- Synchronous-to-asynchronous changes are breaking.
- Asynchronous-to-synchronous changes are breaking.
- Promise and PromiseLike payloads use return-position variance after their
  async wrapper is preserved.

## Conservative type boundary

Phase 5B proves directional compatibility for normalized primitive, literal,
`never`, `unknown`, and top-level union types. It does not guess structural
assignability between arbitrary named, conditional, mapped, intersection,
function, or deeply generic types. A changed type outside the proven subset
produces:

- A manifest-ready change with `compatibility: unknown`
- A required explicit unknown with both declaration locations
- An incomplete rule result rather than a false clean conclusion

Phase 5C adds dedicated structural and package rules instead of widening this
callable heuristic.

## Determinism and containment

- Artifact, comparison, overload, rule, finding, unknown, and evidence ordering
  are canonical.
- Declaration or overload input order cannot select an ambiguous match.
- Rule execution uses the Phase 5A frozen and isolated state boundary.
- Rule exceptions and malformed output remain contained as analyzer gaps.
- Stable rule versions and semantic digests change when conclusions change.

## Automated verification

The focused suite proves:

- Exported function and method removal detection
- Required and optional parameter addition
- Parameter removal and optionality changes
- Parameter narrowing and widening
- Removed overload detection
- Generic constraint narrowing
- Return widening and narrowing
- Sync/async transition detection
- Explicit ambiguous-overload and complex-type unknowns
- Exact comparison binding rejection
- Repeat-run state and semantic-result determinism
- Evidence ownership and advisory-only metadata
- Correct conclusions for the relevant ChangeBench callable fixtures
- No finding for the ChangeBench safe internal implementation change

## Intentionally deferred

- Interface, field, type-alias, class-surface, re-export, and package-export
  compatibility (Phase 5C)
- OpenAPI discovery and compatibility (Phases 5D–5F)
- Consumer linkage and test intelligence (Phase 6)
- Final manifest policy evaluation and CLI presentation (Phase 7)

## Reviewer commands

```bash
cd '/Users/anshumaansharma0404gmail.com/Desktop/ByteSmith'
corepack pnpm install --frozen-lockfile
corepack pnpm check
git diff --check
git status --short --branch
```

## Exit decision

Approve Phase 5B only when the full workspace gate passes, every supported
callable conclusion is backed by revision-correct contract evidence, ambiguous
overloads and unproven type relations remain explicit unknowns, safe internal
changes produce no findings, and every rule remains advisory and ineligible for
blocking.
