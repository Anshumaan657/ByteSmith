# Phase 6D Review Checklist — Jest and Vitest Discovery

## Review scope

This branch delivers deterministic, revision-bound Jest and Vitest discovery.
It does not recommend, rank, execute, skip, or generate tests; those behaviors
remain outside this slice.

## Project and framework discovery

- [x] Detect Jest and Vitest from repository-owned dependencies, scripts,
  inline Jest configuration, and static configuration files.
- [x] Discover root and workspace-package test projects independently.
- [x] Support `jest.config` and `vitest.config` JSON, JavaScript, and TypeScript
  variants plus static `vite.config` test configuration.
- [x] Parse exported object literals, local constant bindings, CommonJS
  `module.exports`, and `defineConfig`/`defineProject` wrappers.
- [x] Never import or execute repository configuration code.
- [x] Ignore dependency, output, VCS, and coverage directories.
- [x] Refuse to follow symbolic filesystem entries and retain a diagnostic.

## Test file and name discovery

- [x] Apply supported Jest `testMatch` and Vitest `include`/`exclude` glob
  patterns relative to the statically resolved project root.
- [x] Apply Jest/Vitest default `test` and `spec` naming conventions when no
  supported include pattern is configured.
- [x] Support Jest `__tests__` directories.
- [x] Separate files that explicitly import Vitest or `@jest/globals`.
- [x] Extract literal `describe`, `test`, and `it` names with nested suite
  qualification.
- [x] Recognize supported modifiers such as `only`, `skip`, `todo`,
  `concurrent`, and `each` without changing execution behavior.
- [x] Preserve exact repository-relative paths and source coordinates.
- [x] Do not invent names for dynamically computed tests.

## Commands, evidence, and canonical IR

- [x] Detect npm, pnpm, or Yarn from the root package manager declaration or
  lockfile.
- [x] Select a repository-owned framework script deterministically.
- [x] Produce shell-quoted, package-relative runnable commands for each test
  file without executing them.
- [x] Bind projects, files, cases, commands, evidence, and IR records to an
  exact Git revision.
- [x] Project each statically named test into canonical `IrTest` records.
- [x] Produce stable evidence IDs, record IDs, ordering, and repeated-run
  equality.
- [x] Convert dynamic configuration, unsupported patterns, and dynamic names
  into visible possible canonical gaps.

## Safety boundaries

- [x] Unsupported Jest regular-expression matching is reported rather than
  interpreted as glob syntax.
- [x] No test process, config module, network request, or package installation
  is initiated by discovery.
- [x] No claim that a test is relevant or absent is made in Phase 6D.
- [x] No coverage ingestion, Playwright discovery, history scoring, or test
  generation is introduced.

## Validation

- [x] Static Vitest configuration discovers nested exact names and excludes a
  configured directory.
- [x] Workspace Jest configuration resolves its root and package-local command.
- [x] A throwing dynamic configuration file is inspected without execution and
  creates a canonical gap.
- [x] Dynamic test names remain visible and are not projected as invented
  tests.
- [x] Mixed Jest/Vitest files remain assigned to their explicit framework.
- [x] Base/head projection creates revision-specific canonical test records.
- [x] Repeated runs produce deeply equal discovery and canonical IR.

## Full quality gate

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

## Expected review result

- Reviewers can trace every discovered test to an exact source location and
  exact revision.
- Every emitted command comes from a repository-owned package script.
- Unsupported or dynamic discovery behavior remains visible as incomplete
  analysis and cannot masquerade as exhaustive discovery.
- Phase 6E test recommendations and “no test found” gaps remain intentionally
  unimplemented.
