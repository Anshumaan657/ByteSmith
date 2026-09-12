# Phase 8E review checklist — workflow hardening

- [x] The Action runtime matches the repository's Node requirement.
- [x] Cancellation reaches the shared engine through an `AbortSignal`.
- [x] Workflow concurrency cancels obsolete pull-request runs.
- [x] Full-history checkout uses the exact event head.
- [x] Publication revalidates the pull-request head after analysis.
- [x] Forks use summary-only reporting without write-token assumptions.
- [x] Evidence links support GitHub Enterprise server URLs.
- [x] Reports are bounded below GitHub's comment-size limit.
- [x] Reporting and engine failures preserve advisory workflow behavior.
- [x] Installation, permissions, inputs, outputs, and troubleshooting are documented.
- [x] Source and committed bundle pass parity tests.
- [x] The repository-wide quality gate passes.
