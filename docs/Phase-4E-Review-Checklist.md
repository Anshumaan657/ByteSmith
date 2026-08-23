# Phase 4E Review Checklist — Deterministic Analyzer Integration

## Review outcome

Phase 4E completes the TypeScript and JavaScript semantic analyzer by placing
Phases 4A–4D behind one revision-bound, failure-contained comparison API:

```ts
runTypeScriptAnalyzerComparison(options)
```

The result contains canonical IR, a SHA-256 semantic digest, manifest-ready
analyzer/evidence/unknown records, and an optional exact-snapshot incremental
seed. This phase does not issue compatibility verdicts or compute transitive
impact; those remain Phase 5 and Phase 6 responsibilities.

## Exact input boundary

- Stable Phase 3 repository identity
- Full base and head Git object IDs
- Absolute base and head snapshot directories
- Deterministic SHA-256 digest of every snapshot entry except `.git` and
  `node_modules`
- Snapshot digest comparison before and after clean analysis
- No host absolute paths in semantic output
- A changed or unreadable snapshot fails closed

## Worker containment and resource limits

Compiler discovery, parsing, resolution, symbol extraction, and relationship
analysis execute in one worker by default. The public limits are:

- `timeoutMs` — 60,000
- `maxOldGenerationSizeMb` — 512
- `maxProjects` — 128 across both revisions
- `maxSourceFiles` — 50,000 across both revisions
- `maxSymbols` — 250,000 across both revisions
- `maxRelationships` — 500,000 across both revisions
- `maxDiagnostics` — 2,000 across both revisions

Timeouts and worker failures return analyzer status `error`. Count-limit
violations return `incomplete`. Both paths emit a required `analyzer_gap`; they
can never become a clean pass. Worker messages are sanitized so snapshot paths
and stack traces do not enter semantic output.

## Canonical IR and manifest projection

The integration projects both revisions into the shared Phase 3 IR model:

- Source files and package manifests
- Symbols and public contracts
- Package exports
- Imports, exports, re-exports, calls, and references
- Revision-bound evidence for every record
- Required gaps produced by compiler and analyzer boundaries
- Deterministically sorted, validated records
- Canonical JSON and its SHA-256 semantic digest

The manifest projection includes one required `bytesmith.typescript` analyzer,
all projected evidence, and every IR gap as a manifest unknown. Phase 7 will
combine this projection with repository inventory, change detection, policies,
and the final Impact Manifest.

## Explicit uncertainty

The integrated boundary preserves useful compiler facts while refusing to hide
unsupported runtime behavior:

- Computed and dynamic imports → `dynamic_import`
- Runtime reflection and `eval` → `reflection`
- Explicit generated-file markers and generated filenames → `generated_code`
- Recognized decorator/container dependency injection → `analyzer_gap`
- Unresolved modules and supported repository symbols → `unresolved_symbol`
- Parse, configuration, type-check, and unsupported-signature failures →
  `analyzer_gap`

Every listed gap is required. A comparison containing one remains incomplete.

## Clean and incremental agreement

An incremental seed is reused only when all of the following agree exactly:

- Repository, base revision, and head revision
- Base and head filesystem snapshot digests
- Analyzer version and all resource limits
- Compiler-analysis and symbol-match revision bindings
- Structurally and semantically valid canonical IR
- Recomputed SHA-256 semantic digest

Any stale, mismatched, or corrupted seed is discarded and the analyzer runs
clean. A valid incremental execution returns the exact same canonical IR and
semantic digest as the original clean execution. Runtime duration is excluded
from that equality.

## Automated verification

Phase 4E tests prove that:

- Repeated clean runs produce byte-identical canonical IR.
- Exact incremental reuse preserves the semantic digest.
- Corrupted and stale seeds execute clean.
- Symbol limits and one-millisecond timeouts produce required gaps.
- Reflection, generated code, and dependency injection stay visible.
- The ChangeBench path-alias case retains authoritative call relationships and
  no false unresolved-symbol gap.
- The ChangeBench dynamic-import case remains incomplete with a required
  dynamic-import unknown.
- A generated 40-module-per-revision fixture completes inside a 30-second
  performance budget.
- All earlier Phase 4 project, compiler, symbol, signature, relationship, and
  matching tests remain green.

## Intentionally deferred

- Contract compatibility classification (Phase 5)
- Bounded transitive impact and test selection (Phase 6)
- Full inventory/change/policy Impact Manifest assembly (Phase 7)
- CLI, CI, and GitHub reporting surfaces (Phases 8–9)

## Reviewer commands

```bash
cd '/Users/anshumaansharma0404gmail.com/Desktop/ByteSmith'
corepack pnpm install --frozen-lockfile
corepack pnpm check
git diff --check
git status --short --branch
```

## Exit decision

Approve Phase 4E only when the full repository gate passes and review confirms
that a timeout, worker failure, resource breach, snapshot mutation, invalid
input, stale seed, or required compiler gap cannot produce a completed analyzer
status or a clean semantic conclusion.
