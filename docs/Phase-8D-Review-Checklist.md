# Phase 8D Review Checklist — Stable Advisory Reporting

- [x] Reports are rendered from the validated Impact Manifest only.
- [x] Reports show exact revisions, semantic digest, coverage, changes, consumers, tests, gaps, unknowns, and analyzer health.
- [x] Source evidence links are pinned to the exact analyzed head commit.
- [x] A stable hidden marker identifies the single ByteSmith bot report.
- [x] Re-runs update the existing bot report instead of creating duplicates.
- [x] The live pull-request head is revalidated immediately before publication.
- [x] Stale results are refused.
- [x] Fork and token permission failures fall back to the GitHub job summary.
- [x] Verify 0.1 reports are explicitly advisory and do not fail the workflow.
