# ByteSmith Impact Manifest specification

## Purpose

The Impact Manifest is ByteSmith’s canonical, versioned verification result.
The CLI, GitHub Action, and any future interface MUST use this contract. It
records changed scope, compatibility conclusions, affected consumers, test
evidence, analysis limits, governance state, provenance, and integrity.

The structural contract is `../schemas/impact-manifest.schema.json`. Terms are
defined in `vocabularies.md`; result derivation is defined in
`result-states.md`; semantic normalization is defined in
`canonicalization.md`; cross-field checks are defined in
`semantic-validation.md`.

## Top-level sections

### Identity and exact input binding

- `schemaVersion` — manifest contract version.
- `manifestId` — runtime identity; excluded from semantic equality.
- `generatedAt` — runtime timestamp; excluded from semantic equality.
- `engine` — engine and rule-set versions.
- `repository` — stable repository identity, name, VCS, and optional remote.
- `comparison` — exact base, head, and optional merge-base revisions.
- `configurationDigest` — digest of normalized effective configuration.

### `status`

`status.conclusion` MUST equal the deterministic derivation in
`result-states.md`. `status.reasons` contains stable codes and readable
summaries. Presentation adapters MUST preserve this conclusion.

### `scope`

`scope.files` enumerates every normalized changed file exactly once.
`scope.coverage` reports exact bucket totals. Unsupported, ignored, generated,
and intentionally excluded paths remain visible and in the denominator.

### `analyzers`

Each analyzer records stable ID, version, whether it is required, status, and
diagnostics. Duration is runtime-only. `not_applicable` is valid only when the
analyzer’s declared input domain does not occur in the full diff.

### `evidence`

Evidence has a stable ID, repository/revision-pinned location, deterministic
producer and version, evidence kind, and summary. Authoritative changes and
impacts MUST reference evidence. Heuristic evidence cannot independently block.

### `changes`

A change is a semantic difference such as an exported symbol, API, database,
event, configuration, dependency, or infrastructure contract change. It records
compatibility classification, component, summary, and evidence references.

### `impacts`

An impact is an immutable finding connecting changes to affected components. It
records rule/version, category, severity, confidence, source changes, affected
components, summary, and evidence. Governance state is not stored on the
finding.

### `tests`

- `tests.recommended` contains exact test commands with reasons and evidence.
- `tests.gaps` contains immutable findings for affected behavior where adequate
  test evidence was not found or was proven absent; the wording distinguishes
  those states.

### `unknowns`

Unknowns are first-class: unsupported files, dynamic imports, reflection,
generated-code limits, missing repositories, unresolved symbols, analyzer gaps,
and other explicit limits. Unknowns MUST NOT be hidden as diagnostics.

### `policies`

Each policy result binds a rule/version and records requiredness, advisory or
blocking mode, explicit enablement, blocking eligibility, active/suspended rule
state, result, finding references, and analysis-gap references.

A suspended policy:

- has a `suspensionId`;
- returns `warn` when it runs safely and retains its findings; or
- returns `not_evaluated` with explicit analysis gaps when unsafe.

It cannot participate in blocking failure.

### Governance records

- `dispositions` add state to immutable findings without modifying them.
- `appeals` record creation, review, terminal outcomes, adjudication, and audit
  references.
- `waivers` record explicit scope, actor, reason, validity interval, conditional
  scope identity/selector/approval, status, and audit references.
- `suspensions` record rule/version, scope, actor, reason, evidence, start time,
  reinstatement criteria, and audit references.
- `auditEvents` provide immutable workflow transition evidence.

Historical manifests are immutable. A later evaluation creates a new manifest.

### `integrity`

`integrity.semanticDigest` hashes the canonical semantic bytes described in
`canonicalization.md`. Optional signatures cover the digest. The digest,
signature, and key ID are excluded from the content being digested.

## Compatibility policy

ByteSmith uses semantic versioning for the manifest schema:

- Patch: clarification or constraints that do not change valid instances.
- Minor: backward-compatible optional additions or enum extensions explicitly
  tolerated by the preceding version.
- Major: removed/renamed fields, changed meaning, or newly required fields.

Consumers MUST reject unsupported major versions. They MUST NOT silently ignore
semantics capable of changing a conclusion.
