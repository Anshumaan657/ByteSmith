# Phase 9C review checklist — performance and reliability

- [x] Each benchmark case records wall-clock duration and peak resident memory.
- [x] Aggregate and segmented reports retain the maximum observed memory.
- [x] Runtime measurements do not create semantic baseline drift.
- [x] Repeated executions still enforce 100% semantic determinism.
- [x] Analyzer crashes remain explicit and the release gate requires zero.
- [x] Development fixtures enforce the under-30-second small-change budget.
- [x] The preferred peak-memory budget is enforced below 3 GiB.
- [x] The semantic analyzer remains single-worker and already carries a bounded
  medium-fixture test with a two-minute limit.
