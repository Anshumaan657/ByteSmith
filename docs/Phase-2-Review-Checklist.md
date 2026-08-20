# Phase 2 review checklist

## Review command

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

## Exit-gate evidence

- [x] Production `@bytesmith/changebench` API replaces reliance on the Phase 0
      matcher prototype for new benchmark execution.
- [x] Fixture discovery is deterministic and every case validates against the
      frozen Draft 2020-12 schema.
- [x] Each `mvp-01` through `mvp-20` behavior is represented exactly once.
- [x] All Phase 0 governance safety fixtures remain in the suite.
- [x] Before and after snapshots are copied into isolated temporary directories
      and cleaned after execution.
- [x] Symbolic links and snapshot paths that escape their fixture are rejected.
- [x] Required, forbidden, and unexpected results produce structured mismatch
      diagnostics.
- [x] Unexpected or forbidden actual results are counted once per result as
      false positives.
- [x] Precision, recall, F1, test-selection recall, unsupported, incomplete,
      crash, determinism, and duration metrics are reported.
- [x] Metrics are segmented by fixture tags and required capabilities.
- [x] Repeated execution compares SHA-256 semantic digests after removing only
      the frozen runtime fields.
- [x] Semantic-set ordering cannot cause nondeterminism, while conclusion
      changes do.
- [x] Report writing and baseline comparison are implemented and tested.
- [x] Baselines ignore durations but reject semantic result changes.
- [x] The engine has no network, clock, generated revision, or host-path
      dependency in its expected outputs.
- [x] Executor crashes are captured as failed case results and crash metrics.

## Phase boundary

Phase 2 supplies the benchmark harness and the expected behavior contracts. It
does not implement Git inventory, TypeScript/OpenAPI analysis, consumer graph
construction, or test discovery. Those production executors arrive in later
phases and plug into the `ChangeBenchExecutor` interface.

## Reviewer decision

- [ ] Approve Phase 2 and merge the pull request.
- [ ] Request changes before merge.
