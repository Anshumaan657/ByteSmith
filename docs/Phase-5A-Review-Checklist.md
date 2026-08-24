# Phase 5A Review Checklist — Shared Contract-Rule Foundation

## Review outcome

Phase 5A turns the previously empty `@bytesmith/analyzer-sdk` workspace into
the shared compatibility-rule boundary for TypeScript and OpenAPI. It does not
classify a real language contract yet. It defines how later rules match inputs,
prove conclusions, fail safely, and project their output toward the frozen
Impact Manifest.

The two public entry points are:

```ts
createContractComparisons(input)
executeContractRules(definitions, input)
```

`ContractRuleRegistry` provides the reusable, prevalidated registry form.

## Conservative base/head matching

Contract-family packages provide their own normalized logical keys and artifact
values. The shared matcher then:

- Requires valid canonical IR.
- Accepts artifacts only from the selected base or head revision.
- Requires revision-matching, non-heuristic evidence.
- Rejects duplicate artifact IDs.
- Requires canonical JSON-compatible artifact values.
- Sorts logical keys and artifacts deterministically.
- Produces `matched`, `added`, `removed`, or `ambiguous` groups.
- Never chooses one candidate when either revision contains multiple artifacts
  for the same logical key.
- Includes artifact values in stable comparison identity.

The TypeScript and OpenAPI slices remain responsible for defining safe logical
keys. Phase 5A deliberately does not guess names or identities for them.

## Versioned rule registry

Every contract rule declares:

- Stable rule ID
- Rule version
- `shared`, `typescript`, or `openapi` family
- Non-empty description
- Requiredness
- `advisory` default mode
- `blockingEligible: false`
- Synchronous or asynchronous evaluator

Registration rejects duplicate active rule IDs, even when the duplicate uses a
different version. Rules execute in stable ID/version order. The rule-set ID is
derived from the sorted active definitions, so version or requiredness changes
cannot reuse the previous rule-set identity.

## Finding and evidence contract

Rule findings retain internal rule ID/version provenance and expose a frozen
schema-compatible `ManifestChange` projection containing:

- Stable change ID
- Change kind
- Summary
- `compatible`, `potentially_breaking`, `breaking`, or `unknown`
- Component reference
- Evidence IDs

Each finding must explicitly require base evidence, head evidence, or both. The
engine verifies that every referenced evidence record exists in canonical IR,
belongs to the required revision, and is not exclusively heuristic. Repeated
semantically identical findings and unknowns are deduplicated before canonical
sorting.

The Phase 0 Impact Manifest schema remains unchanged. Rule provenance stays in
the execution result while the existing manifest change shape remains stable.

## Ambiguity and failure behavior

- A compatibility of `unknown` makes that rule execution incomplete.
- Rule-provided unknowns retain type, locations, evidence, and blocking
  relevance.
- A relevant unknown makes execution incomplete.
- Rule inputs are structured-cloned and frozen.
- A rule cannot mutate another rule's input or the caller's state.
- A thrown exception or malformed output does not stop later rules.
- A failed rule emits deterministic runtime evidence and an `analyzer_gap`.
- Required rule failure produces aggregate status `error` and required blocking
  relevance.
- Optional rule failure produces aggregate status `incomplete` and possible
  blocking relevance.
- Exception messages and stack traces are excluded from semantic output.

No Phase 5A failure can be interpreted as a clean compatibility result.

## Determinism

The result contains:

- Exact repository/base/head binding
- Stable rule-set ID
- Aggregate status
- Per-rule executions
- Version-attributed findings
- Manifest-ready changes and unknowns
- Runtime evidence generated for contained failures
- SHA-256 semantic digest

Rule registration order, finding order, unknown order, diagnostic order, and
exact duplicate output do not alter the semantic result.

## Automated verification

Tests prove that:

- Reversed rule registration produces identical output and digest.
- Matching detects added, removed, matched, and ambiguous contracts.
- Reversed artifact input produces identical comparisons.
- Cross-revision, duplicate, unprovable, and non-canonical artifacts fail.
- Required base/head evidence is enforced.
- Ambiguity remains an incomplete unknown.
- Required and optional crashes retain different blocking relevance.
- Crashes do not prevent later healthy rules from running.
- Host paths from thrown errors do not leak into output.
- Rule inputs are isolated and frozen.
- Duplicate rules and non-advisory definitions are rejected.
- Rule-version changes alter rule-set, finding, and semantic identity.
- Invalid canonical IR and non-cloneable state fail before execution.
- An empty registry produces an explicit deterministic completed result.

## Intentionally deferred

- TypeScript function/method compatibility (Phase 5B)
- TypeScript structural/package compatibility (Phase 5C)
- OpenAPI parsing and canonicalization (Phase 5D)
- OpenAPI operation compatibility (Phase 5E)
- OpenAPI schema compatibility and Phase 5 metrics (Phase 5F)
- Consumer impacts and test intelligence (Phase 6)
- Final Impact Manifest assembly and CLI output (Phase 7)

## Reviewer commands

```bash
cd '/Users/anshumaansharma0404gmail.com/Desktop/ByteSmith'
corepack pnpm install --frozen-lockfile
corepack pnpm check
git diff --check
git status --short --branch
```

## Exit decision

Approve Phase 5A only when the full repository gate passes and review confirms
that rule order cannot change semantic output, conclusions cannot reference
missing or wrong-revision evidence, ambiguity is never guessed, all Verify 0.1
rules remain advisory, and any required rule failure is a visible required gap.
