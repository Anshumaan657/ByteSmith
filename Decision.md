# ByteSmith decision log

This is the durable record of material engineering decisions visible in the
repository. Add a dated entry whenever a change affects architecture, safety,
supported behavior, dependencies, performance, or release policy. Do not log
small formatting-only edits.

## Current product decision

ByteSmith is an **offline, advisory change-impact verifier**. It compares two
exact Git revisions, determines what contract changed, identifies proven
consumers, recommends relevant tests, and shows evidence and limitations.

It is not an AI code-review bot, a test runner, a merge blocker, or a general
static-analysis platform in Verify 0.1.

## Decision record

### D-001 — Build one TypeScript monorepo for the MVP

**Decision:** Use Node.js, TypeScript, pnpm workspaces, and private internal
packages.

**Reasoning:** The TypeScript compiler API is the most reliable source of
semantic TypeScript/JavaScript information for the initial scope. Workspaces
separate responsibilities without pretending each package is an independently
published product.

**Trade-off:** The first analyzer is strongest for TS/JS repositories. Python
and other languages are deferred rather than superficially supported.

### D-002 — Use exact Git commits, not the working tree

**Decision:** Bind analysis to exact base/head commits and an exact merge base;
materialize isolated snapshots.

**Reasoning:** Pull-request results must be reproducible and evidence links
must keep pointing to the code that was analyzed.

**Trade-off:** The tool requires Git history and rejects stale or shallow inputs
instead of silently analyzing an approximate state.

### D-003 — Keep one Canonical IR and revision-bound evidence model

**Decision:** All analyzers emit a common Canonical Intermediate Representation
(IR) and evidence records before downstream processing.

**Reasoning:** Consumer linking, test recommendations, manifests, the CLI, and
the Action should not need language-specific logic. Evidence makes every
conclusion inspectable.

**Trade-off:** Analyzer implementations must satisfy strict shared contracts,
which increases upfront engineering work but prevents incompatible outputs.

### D-004 — Prefer explicit unknowns over guessed conclusions

**Decision:** Dynamic imports, reflection, unresolved modules, generated code,
and unprovable type relationships become visible unknowns or gaps.

**Reasoning:** A confident but false consumer/test claim is worse than a clear
limitation in a change-impact tool.

**Trade-off:** Some results are incomplete or warnings even when a human could
infer the answer from runtime knowledge.

### D-005 — Make Verify 0.1 advisory, not merge-blocking

**Decision:** The GitHub Action reports findings but never blocks a merge.

**Reasoning:** The MVP must earn trust through useful, explainable results
before being used as a policy enforcement mechanism.

**Trade-off:** Teams must make their own merge decision; ByteSmith does not
provide a security or compliance boundary.

### D-006 — Run only analyzers claimed by changed files

**Decision:** Use the exhaustive repository inventory to decide whether each
analyzer is applicable. Documentation-only changes mark TS/OpenAPI/tests as
`not_applicable`.

**Reasoning:** This avoids expensive, irrelevant analysis and prevents
documentation changes from surfacing a misleading analyzer crash.

**Trade-off:** Analyzer status is a precise statement about changed-file scope,
not a claim that the entire repository was reanalyzed.

### D-007 — Use static test discovery and bounded consumer paths

**Decision:** Parse Jest/Vitest configuration without executing it, and cap
consumer traversal with configured depth/edge/consumer limits.

**Reasoning:** Executing repository configuration is unsafe; unbounded graphs
can make pull-request analysis unpredictable.

**Trade-off:** Dynamic configs/test names and very deep relationships may be
reported as incomplete rather than fully resolved.

### D-008 — Store local results in SQLite with immutable manifests

**Decision:** Use Node's built-in SQLite interface for local cache/history;
validate every manifest before persisting it.

**Reasoning:** The product needs no account, cloud service, or external
database, while repeated exact analyses can reuse valid results.

**Trade-off:** SQLite remains an experimental Node API and cache corruption is
handled conservatively as a visible miss/quarantine event.

### D-009 — Make ChangeBench the source of measured claims

**Decision:** Use versioned before/after fixtures and repeated execution to
measure contract precision, direct-consumer precision, test recall,
determinism, crashes, duration, and peak memory.

**Reasoning:** A release claim needs measurable behavior, not hand-picked demo
screenshots.

**Trade-off:** Fixture expectations must be maintained as the analyzer evolves;
passing unit tests alone does not prove release quality.

### D-010 — Give the GitHub Action a committed bundle

**Decision:** Commit the built Action bundle and test parity between the bundle
and the direct shared engine.

**Reasoning:** GitHub Actions run the bundled artifact, not TypeScript source.
Parity tests ensure the deployed behavior matches local behavior.

**Trade-off:** Any Action-reachable source change requires rebuilding and
reviewing the bundle diff.

### D-011 — Keep Python as a plug-in extension, not a rewrite

**Decision:** Do not rewrite the current TypeScript codebase in Python. A future
Python analyzer should plug into the existing snapshot → IR → manifest flow.

**Reasoning:** The shared pipeline already solves Git binding, evidence,
consumer/report structure, CLI output, storage, and Action reporting. Only the
language-specific analysis needs to change.

**Trade-off:** Python support is not available in Verify 0.1; it requires a
real AST/type/import/test implementation and its own ChangeBench cases.

### D-012 — Make release evidence fail closed

**Decision:** `release:audit` emits a machine-readable report and exits nonzero
until every automated gate, five real-repository evaluations, and five
independent usability evaluations are complete.

**Reasoning:** Pending placeholders must never become an accidental `v0.1.0`
claim. The audit should reveal missing evidence, not manufacture it.

**Trade-off:** The current project is demo-ready after normal checks pass, but
is not honestly public-release-ready while audit gates remain unsatisfied.

## Decision template for future changes

```md
### D-XXX — Short decision title

**Date:** YYYY-MM-DD

**Decision:** What was chosen?

**Reasoning:** Why is this the best fit for ByteSmith now?

**Alternatives considered:** What else was possible?

**Trade-off:** What limitation, cost, or risk was accepted?

**Affected flow:** Which entry point, package, schema, test, or deployment path changes?
```
