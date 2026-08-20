# ByteSmith ChangeBench specification

## Purpose

ChangeBench is an executable contract for analyzer accuracy, noise,
determinism, failure safety, suspension visibility, waiver reactivation, and
performance. It is not a set of demonstrations.

Cases validate against `../schemas/changebench-case.schema.json`.

## Fixture layout

```text
changebench/fixtures/<case-id>/
├── case.json
├── before/
├── after/
└── README.md              # optional explanation
```

`before` and `after` are immutable snapshots. A runner MAY materialize Git
commits, but expected semantic output MUST NOT depend on generated commit hashes,
temporary paths, clocks, durations, or host data.

## Assertion groups

- `requiredChanges` — every matcher matches at least one change.
- `forbiddenChanges` — no matcher may match a change.
- `requiredImpacts` — every matcher matches at least one impact.
- `forbiddenImpacts` — no matcher may match an impact.
- `requiredTests` — every matcher matches a recommendation.
- `forbiddenTests` — no matcher may match a recommendation.
- `requiredUnknowns` — every expected limitation is surfaced.
- `forbiddenUnknowns` — known-resolvable behavior is not labeled unknown.
- `requiredPolicies` — required rule state/result/finding behavior appears.
- `forbiddenPolicies` — prohibited rule state/result behavior does not appear.
- `requiredWaivers` — required scope/status behavior appears.
- `coverage` — exact full-diff denominator and bucket counts.
- `conclusion` — exact derived manifest conclusion.

Matchers intentionally omit runtime-only fields.

## Required `allowUnexpected`

Every case MUST explicitly provide `expected.allowUnexpected`.

- `false` means every unmatched change, impact, test, unknown, policy, or waiver
  is a case failure unless another matcher permits it. Each unexpected result is
  counted as a false positive.
- `true` is permitted only when top-level `unexpectedRationale` explains why
  exhaustive matching is impossible.
- Blocking-rule fixtures SHOULD use `false`.
- Scope MUST never default silently.

A suite that checks only required findings is not ChangeBench-conformant.

## Required Phase 0 safety cases

The initial contract suite includes:

- unsupported file retained in the denominator;
- required analyzer error cannot pass;
- safely executed suspended rule remains visible as warning;
- unsafe required suspended rule emits a gap and derives incomplete;
- repository suspension does not become global;
- expired/revoked waiver reactivates a still-applicable finding;
- `allowUnexpected: false` rejects an unmatched result.

Phase 2 expands this foundation to the complete 20-case MVP behavior set while
retaining every Phase 0 governance safety fixture. Broader analyzer coverage is
added with the analyzers in later phases.

## Runner behavior

The runner MUST:

- validate fixture structure and matcher schema;
- materialize immutable before/after snapshots;
- normalize nondeterministic runtime fields;
- evaluate all required and forbidden groups;
- enforce `allowUnexpected` and its rationale rule;
- compare canonical semantic output across repeated runs;
- report precision, recall, F1, test-selection recall, unsupported rate,
  incomplete rate, and determinism rate; and
- segment results by rule, framework pack, language, analyzer version, and
  repository type rather than reporting only aggregates.

## Real-code requirement

Synthetic fixtures are necessary but insufficient for blocking eligibility.
Real advisory findings from unrelated design partners and the complete gate in
`rule-graduation.md` remain mandatory.
