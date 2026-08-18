# ByteSmith interface reporting contract

## Shared rule

Every interface consumes the same validated Impact Manifest and preserves
`status.conclusion`, exact revisions, engine/rule versions, finding IDs,
evidence references, waiver state, suspension scope/reason, and analysis gaps.
No adapter may turn `warn`, `incomplete`, or `error` into ByteSmith `pass`.

## CLI

Human and machine output MUST:

- keep suspended-rule findings in the normal finding hierarchy;
- label them `suspended` and show scope and reason;
- show safe suspended execution as warning;
- show unsafe execution as `not_evaluated` plus its unknown/gap;
- show required unsafe execution as `incomplete`;
- keep active/expired/revoked waiver state visible without modifying findings;
- provide distinct stable exit codes for pass, warn, fail, incomplete, error,
  invalid configuration, and unsupported schema version; and
- include the unchanged conclusion in JSON and compact CI output.

## GitHub reports

The GitHub Action/check adapter MUST:

- publish one revision-bound report rather than hiding findings or creating
  comment spam;
- map ByteSmith states without accepting incomplete/error/stale analysis as a
  successful current-revision check;
- show suspended findings as warnings or explicit `not_evaluated` gaps;
- show suspension scope, reason, and audit/governance reference;
- show appeal and waiver commands or links without mutating original findings;
- keep emergency disable visible and audited; and
- prevent a result for an older head revision from satisfying the current head.

## MCP and Self-Hosted

MCP responses carry manifest revision, digest, engine/rule versions, status, and
unknowns. AI summaries cannot mutate evidence or status. Self-Hosted views retain
the same result hierarchy and governance records.

These requirements are normative now and implemented/tested by their later
delivery phases against the frozen manifest contract.
