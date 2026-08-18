# ByteSmith rule graduation and suspension

## Version-specific lifecycle

Each rule version independently progresses through:

1. `experimental`
2. `advisory`
3. `blocking_eligible`
4. `blocking_enabled` by explicit repository policy
5. `suspended` when regression evidence appears

Phase completion never changes lifecycle state automatically.

## Blocking eligibility gate

A rule version becomes `blocking_eligible` only when every condition is true:

- precision is at least 99% for its rule class;
- recall is at least 95%;
- behavior is stable across three released analyzer versions;
- at least 200 real advisory findings exist;
- findings span at least three unrelated partner repositories;
- the latest 100 findings contain no unresolved high-severity false positive;
- every blocking result has complete deterministic evidence;
- local and CI normalized semantic output is equal for identical inputs;
- analyzer and policy failure states are proven safe;
- repository enforcement is explicit opt-in;
- emergency disable exists and is audited;
- at least one appeal was created, adjudicated to a terminal outcome, and
  recorded in the audit trail;
- at least one temporary waiver became active, expired or was revoked, and was
  followed by re-evaluation proving a still-applicable finding became active;
- both workflows pass automated end-to-end tests; and
- a real discrepancy became a regression fixture, or an independent adversarial
  evaluation challenged the rule.

No deadline or customer request bypasses this gate.

## Scriptable appeal requirement

The automated workflow MUST prove:

1. creation against an immutable finding;
2. transition to review;
3. adjudication with rationale and actor;
4. terminal outcome `upheld`, `rejected`, or `superseded`;
5. an immutable audit event for every transition; and
6. no mutation of the original finding.

`upheld` requires regression work because the finding was wrong. `rejected`
keeps the finding valid. `superseded` points to later analysis/rule evidence.

## Scriptable temporary-waiver requirement

The automated workflow MUST prove:

1. explicit scope and required conditional identity/selector/approval;
2. creation with actor, reason, and validity interval;
3. activation and a manifest conclusion of at least `warn`;
4. expiry or authorized revocation with audit events;
5. re-evaluation after deactivation; and
6. reactivation of the still-applicable underlying finding.

## Suspension scopes

- `repository` — affects one repository and requires repository identity.
- `organization` — affects one organization and requires organization identity.
- `global` — affects the rule version everywhere and requires evidence of a
  general regression.

Suspension starts at the narrowest justified scope. One unusual repository MUST
NOT silently disable a rule globally. A confirmed general defect MUST NOT be
misrepresented as repository-only.

Every suspension records rule/version, scope, identity where conditional,
reason, evidence, actor or automated detector, start time, status,
reinstatement criteria, and audit references.

## Visibility while suspended

- A suspended rule cannot block.
- Existing findings remain visible.
- Safe advisory execution emits new findings as `warn` with
  `ruleState: suspended` and the suspension reference.
- Unsafe execution emits `not_evaluated` plus an explicit gap or unknown.
- Unsafe required evaluation derives `incomplete`; non-required evaluation
  derives at least `warn`.
- Suspension can never convert a visible problem into clean `pass`.

Override rate is measured per rule version and scope. A threshold breach first
suspends at the narrowest supported scope. Global suspension requires benchmark
regression or corroborated failures across unrelated repositories.
