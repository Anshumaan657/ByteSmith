# Phase 9A review checklist — release metric contract

- [x] Contract precision is measured independently from other findings.
- [x] Direct-consumer precision is measured independently from other findings.
- [x] Test-selection recall, unsupported rate, incomplete rate, crash rate,
  determinism, and duration remain explicit metrics.
- [x] The benchmark command enforces the 95% contract, 90% consumer, 80% test,
  100% determinism, and zero-crash release thresholds.
- [x] Terminal and JSON benchmark results expose the same measurements.
- [x] Existing baseline semantics remain deterministic.
