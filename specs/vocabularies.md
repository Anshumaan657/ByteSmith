# ByteSmith normative vocabularies

## Purpose

This document defines the stable concepts used by the Impact Manifest and
ChangeBench. Schema enums are authoritative spellings; these definitions are
authoritative meanings.

## Component

A versioned subject of analysis referenced by stable ID, kind, name, and
optional revision-bound location.

Kinds: `file`, `module`, `package`, `symbol`, `api`, `graphql`, `event`,
`database`, `config`, `infrastructure`, `test`, `service`, `repository`.

## Evidence

A deterministic observation produced by a named, versioned producer and tied to
a repository revision and path. Kinds: `syntax`, `type`, `call`, `import`,
`contract`, `configuration`, `coverage`, `runtime`, `history`, `heuristic`.

Heuristic evidence is explicit and is not independently authoritative for
blocking.

## Change

A semantic difference between base and head. Kinds: `symbol`, `contract`,
`schema`, `event`, `configuration`, `dependency`, `infrastructure`.

Compatibility: `compatible`, `potentially_breaking`, `breaking`, `unknown`.
Ambiguity is `unknown`, never a guess.

## Impact / finding

An immutable claim that a change affects a component. Categories: `direct`,
`transitive`, `contract`, `test_gap`, `policy`, `heuristic`. Every impact
references source changes and evidence.

## Test result

A recommendation names a test component, exact command, reason, and evidence.
A test gap is an immutable finding with gap kind `not_found` or `proven_absent`.

## Unknown / analysis gap

An explicit limit: `unsupported_file`, `dynamic_import`, `reflection`,
`generated_code`, `missing_repository`, `unresolved_symbol`, `analyzer_gap`, or
`other`. Blocking relevance is `none`, `possible`, or `required`.

## Analyzer result

Status is `completed`, `incomplete`, `error`, or `not_applicable`. Requiredness
is explicit. Diagnostics remain visible and do not replace unknowns or gaps.

## Policy result

A version-bound rule evaluation. Mode is `advisory` or `blocking`; result is
`pass`, `warn`, `fail`, or `not_evaluated`; rule state is `active` or
`suspended`. Blocking additionally requires eligibility and explicit enablement.

## Disposition

An auditable record separate from an immutable finding. Types: `accepted`,
`appealed`, `waived`, `suppressed`, `resolved`.

## Appeal

An auditable challenge to an immutable finding. Status is `open`,
`under_review`, or `terminal`. Terminal outcome is `upheld`, `rejected`, or
`superseded`.

## Waiver

A time-bounded authorized disposition. Status is `pending`, `active`, `expired`,
or `revoked`. Scope is `finding`, `pull_request`, `repository`, or
`organization`; no scope defaults.

A selector matches `ruleId`, `subjectId`, or both. Organization waivers require
an elevated approval record.

## Suspension

An auditable, rule-version-specific pause in enforcement. Status is `active` or
`reinstated`; scope is `repository`, `organization`, or `global`. Suspension
never deletes findings.

## Audit event

An immutable workflow transition record containing stable ID, entity type and
ID, action, actor, time, and optional from/to status.
