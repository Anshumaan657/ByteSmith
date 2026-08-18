# ByteSmith result states

## Conclusions

Every manifest has exactly one ByteSmith conclusion:

- `pass` — no enabled blocking policy failed and no advisory finding, active
  waiver, suspension, unknown, or analysis gap requires attention within the
  successfully analyzed scope.
- `warn` — attention is required, but no enabled blocking policy failed and no
  required analysis is incomplete or erroneous.
- `fail` — at least one enabled, blocking-eligible, active, non-waived policy
  violation exists.
- `incomplete` — required analysis or required policy evaluation did not
  complete, but ByteSmith produced a structurally valid partial manifest.
- `error` — fatal required analysis, input, platform, integrity, or analyzer
  failure prevents a valid required result.

`pass` never means “safe.” It means no enabled policy failed within the recorded
analyzed scope.

## Normative derivation precedence

Derive the conclusion in this exact order:

1. A required analyzer with `status: error` → `error`.
2. Otherwise, a required analyzer with `status: incomplete`, or a required
   policy with `result: not_evaluated` → `incomplete`.
3. Otherwise, an enabled, blocking, blocking-eligible, non-suspended policy with
   `result: fail` and at least one active non-waived finding → `fail`.
4. Otherwise, any of the following → `warn`:
   - policy result `warn`;
   - suspended-rule finding;
   - policy result `not_evaluated` for a non-required policy;
   - active waiver;
   - non-required analyzer `incomplete` or `error`;
   - an unknown or explicit analysis gap;
   - another advisory finding.
5. Otherwise → `pass`.

An interface MAY map these states to provider-specific conclusions, but it MUST
preserve the ByteSmith conclusion in its report and machine-readable output.

## Suspended rules

Suspension disables enforcement, not visibility.

### Safe advisory execution

When a suspended rule can execute safely:

- the policy has `ruleState: suspended`;
- the policy references its active suspension;
- new and existing findings remain present;
- the policy result is `warn`;
- the suspension reason is available through the referenced suspension; and
- the policy cannot participate in the `fail` step.

### Unsafe execution

When execution is unsafe:

- the policy result is `not_evaluated`;
- it references at least one explicit `analysisGapId`;
- the manifest cannot derive clean `pass`;
- a required policy derives `incomplete`; and
- a non-required policy derives at least `warn`.

Repository, organization, and global suspension scopes are independent. A
repository suspension never silently becomes organization-wide or global.

## Findings and separate dispositions

Original findings are immutable. A disposition is a separate auditable record
with one of these types:

- `accepted`
- `appealed`
- `waived`
- `suppressed`
- `resolved`

The disposition references the finding; it does not modify it.

## Waiver scopes

Every waiver declares one explicit scope:

- `finding` — one immutable finding in one manifest.
- `pull_request` — equivalent occurrences in later revisions of the same pull
  request; requires pull-request identity.
- `repository` — equivalent findings matching an authorized selector in one
  repository; requires repository identity and a rule/subject selector.
- `organization` — equivalent findings matching an authorized selector across
  an organization; requires organization identity, selector, and elevated
  approval.

All waivers include `findingId`, reason, actor, creation time, status, start and
expiry times, and scope. Scope never defaults. An active waiver does not delete
the finding and derives at least `warn`, never `pass`.

## Waiver expiry and revocation

Expiry or revocation does not mutate a historical manifest. On re-evaluation:

- the waiver is inactive;
- a still-applicable finding becomes active again;
- the reactivated finding participates normally in policy derivation; and
- an expired waiver cannot relabel an old manifest as `pass`.

Stateless CLI and GitHub Action runs surface expiry on their next run.
Self-Hosted SHOULD queue re-evaluation when appropriate.

## Appeals

An appeal progresses from `open` to `under_review` and then to terminal status.
Terminal outcomes are:

- `upheld` — the finding was wrong; regression work is required.
- `rejected` — the finding remains valid.
- `superseded` — a later analysis or rule version replaced the finding.

Terminal appeals require adjudicator, adjudication time, rationale, and an audit
event. An appeal does not mutate the original finding.
