# ByteSmith product invariants

## Status and conformance

This document is normative for Impact Manifest schema version `1.0.0`. The key
words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are interpreted as described
by RFC 2119 and RFC 8174 when written in uppercase.

A ByteSmith implementation is conformant only when its schema validation,
semantic validation, normalized output, and user-facing conclusion satisfy every
invariant below. JSON Schema validity alone is insufficient.

## 1. The denominator is the normalized full diff

The changed-file denominator MUST contain every file path touched by the
normalized source-control diff before filtering by language, relevance,
generated status, ignore rules, or analyzer support.

Every changed path MUST appear exactly once in `scope.files` and have exactly one
coverage class:

- `analyzed`
- `partially_analyzed`
- `unsupported`
- `intentionally_excluded`

Unsupported, ignored, generated, and intentionally excluded files MUST remain
visible. They MUST NOT be removed from the denominator or counted as analyzed.
Directory entries and source-control metadata that are not files MAY be removed
only by documented diff normalization.

Testable conditions:

- `scope.coverage.totalChangedFiles === scope.files.length`.
- The four bucket counts sum to `totalChangedFiles`.
- Each bucket count equals the number of files carrying that class.
- Every excluded or unsupported file contains a non-empty reason.

## 2. Measured scope is not unknowable completeness

ByteSmith MUST report observable facts: files inventoried, files parsed, symbols
resolved, contracts analyzed, analyzers completed, and relationships unresolved.
It MUST NOT claim to know the percentage of all real-world consumers or state
that a change is safe merely because no finding was produced.

User-facing conclusions MUST be qualified as applying “within the analyzed
scope.”

## 3. `error` and `incomplete` never collapse into `pass`

A required analyzer error MUST derive `error`. A required analyzer incomplete
result or a required policy result of `not_evaluated` MUST derive `incomplete`
unless `error` already takes precedence. Crashes, timeouts, unsupported required
inputs, invalid analyzer output, and unsafe required rule execution MUST remain
visible and MUST NOT derive `pass`.

## 4. Suspended enforcement never hides a finding

A suspended rule MUST NOT block a merge, but suspension MUST NOT delete or hide
an existing finding.

- When the rule can run safely, it MUST emit findings as advisory results with
  `result: warn`, `ruleState: suspended`, and a suspension reference.
- When the rule cannot run safely, it MUST emit `result: not_evaluated` and at
  least one explicit analysis gap or unknown.
- Unsafe execution of a required rule/analyzer MUST derive `incomplete`.
- Repository, organization, and global suspension scopes MUST remain distinct.
- A suspended rule MUST NOT turn a visible problem into `pass`.

## 5. Every authoritative conclusion has deterministic evidence

Every authoritative change and impact MUST reference deterministic evidence.
Evidence MUST identify its repository, revision, path, producer, producer
version, kind, and human-readable summary. Source locations MUST be included
when available.

A heuristic MAY be reported only when it is explicitly classified as heuristic
and cannot be used as authoritative blocking evidence.

## 6. Original findings are immutable

An original impact or test-gap finding MUST NOT be edited or deleted by an
appeal, waiver, suppression, suspension, or later analyzer result. Dispositions
and governance records MUST be stored separately and reference the immutable
finding ID. Later analysis supersedes through a new manifest rather than
rewriting historical evidence.

## 7. Identical semantic inputs produce identical semantic output

Given identical source inputs, repository revisions, configuration, engine
version, analyzer versions, rule-set version, policies, and governance inputs,
canonical semantic bytes and their digest MUST be identical.

Runtime-only fields—including manifest ID, generation time, durations,
signatures, and the digest field itself—are excluded according to
`canonicalization.md`. Exclusion MUST NOT remove any field that can change the
conclusion.

## 8. AI explains; it does not establish authority

An AI system MAY summarize recorded evidence or propose remediation. It MUST NOT
create an authoritative dependency edge, compatibility classification, coverage
fact, policy result, waiver, suspension, or ByteSmith conclusion. Authoritative
facts require a deterministic producer and recorded provenance.

## 9. Blocking is rule-specific, evidence-based, and opt-in

Blocking eligibility applies to one rule version. Completion of an
implementation phase does not make a rule blocking eligible. A rule MUST satisfy
`rule-graduation.md`, and a repository administrator MUST explicitly enable the
rule or an approved policy bundle. Emergency disable MUST be scoped, visible,
and audited.

## 10. Exact revision and version binding

Every manifest MUST bind repository identity, base revision, head revision,
merge base when applicable, engine version, rule-set version, analyzer versions,
schema version, and configuration digest. A result for one head revision MUST
NOT satisfy or be published as the result for another revision.

## 11. One shared kernel and contract

CLI and GitHub Action interfaces MUST produce or consume the same versioned
Impact Manifest and use the same derivation and canonicalization rules. Any
future presentation adapter MUST NOT invent a different ByteSmith conclusion.

Core verification MUST operate locally without ByteSmith Cloud, an account, or
a paid AI key.

## 12. Semantic validation is mandatory

In addition to Draft 2020-12 schema validation, the semantic validator MUST
check at least:

- full-diff coverage arithmetic and one-class-per-file behavior;
- uniqueness of all IDs in their namespaces;
- all evidence, change, finding, test, unknown, policy, waiver, appeal,
  suspension, disposition, and audit references;
- waiver time intervals and explicit scope-dependent identities/selectors;
- appeal terminal outcomes and adjudication audit records;
- suspended-rule visibility and `not_evaluated` analysis gaps;
- immutable finding separation from dispositions;
- exact result-state derivation;
- declared digest algorithms and semantic digest equality;
- canonicalized path and ordering rules.

Semantic validation failure makes the manifest invalid; it MUST NOT be
published as `pass`.
