# Phase 8A Review Checklist — GitHub Action Foundation

## Action metadata

- [x] `action.yml` declares `using: node20` runtime
- [x] `action.yml` entrypoint is `dist/bundle/index.js`
- [x] Six typed inputs: `base`, `head`, `config`, `database`, `use-cache`, `publish`
- [x] Six typed outputs: `conclusion`, `semantic-digest`, `base-revision`, `head-revision`, `merge-base`, `error-code`
- [x] Branding configured (purple shield)

## Production entry point

- [x] `src/index.ts` exports `ActionEnvironment`, `ActionStartupContext`, `ActionError`
- [x] `src/index.ts` exports `validateActionEnvironment` and `runAction`
- [x] Top-level `await runAction()` guarded by `GITHUB_ACTIONS` + `GITHUB_EVENT_PATH`
- [x] Structured error handling: `ActionError` with stable `.code` property

## Environment validation

- [x] Requires `GITHUB_ACTIONS`, `GITHUB_EVENT_NAME`, `GITHUB_EVENT_PATH`, `GITHUB_REPOSITORY`, `GITHUB_SHA`, `GITHUB_WORKSPACE`
- [x] Rejects missing or empty environment variables with `missing_environment`
- [x] Rejects environment variables containing null bytes or control characters with `invalid_environment`
- [x] Rejects non-`pull_request` events with `unsupported_event`
- [x] Rejects non-object event payloads with `invalid_event_payload`

## Git repository validation

- [x] Discovers Git repository from `GITHUB_WORKSPACE`
- [x] Rejects shallow repositories with `shallow_repository`
- [x] Rejects dirty working trees with `dirty_repository`
- [x] Rejects mismatched `HEAD` vs `GITHUB_SHA` with `unexpected_checkout`

## Advisory behavior

- [x] Sets `conclusion` output to `not_evaluated` on successful startup
- [x] Sets `conclusion` output to `error` on startup failure
- [x] Sets `error-code` output on failure
- [x] Calls `core.setFailed()` on startup failure
- [x] Never blocks a merge (Verify 0.1 is advisory)

## Bundle

- [x] `@vercel/ncc` bundles `dist/index.js` into `dist/bundle/index.js`
- [x] Bundle is self-contained (no runtime dependency installation needed)
- [x] Bundle is reproducible from source via `bundle` script
- [x] `.gitignore` allows `apps/github-action/dist/bundle/index.js` to be committed

## Package configuration

- [x] Private ESM workspace (`"private": true, "type": "module"`)
- [x] Node engine `>=20.0.0` for GitHub Actions runner compatibility
- [x] Dependencies: `@actions/core`, `@bytesmith/vcs-git` (workspace)
- [x] DevDependencies: `@vercel/ncc`
- [x] `build`, `bundle`, and `test` scripts defined

## TypeScript configuration

- [x] Extends `tsconfig.base.json`
- [x] Project reference to `../../packages/vcs-git`
- [x] Root `tsconfig.json` references `./apps/github-action`

## Workspace integration

- [x] `validate-workspace.mjs` includes `apps/github-action`
- [x] `pnpm-workspace.yaml` includes `apps/*`
- [x] `pnpm-lock.yaml` updated

## Tests (15 tests)

- [x] Metadata: node20, bundled entrypoint, all inputs, all outputs
- [x] Bundle: `dist/bundle/index.js` exists
- [x] Success: fully populated environment validates correctly
- [x] Missing environment: GITHUB_ACTIONS, GITHUB_EVENT_PATH, GITHUB_SHA, GITHUB_WORKSPACE, GITHUB_REPOSITORY (5 tests)
- [x] Unsupported events: push, schedule (2 tests)
- [x] Invalid payloads: array, non-JSON (2 tests)
- [x] Shallow repository detection via actual shallow clone
- [x] ActionError: correct name/code, preserves cause (2 tests)

## Existing behavior preservation

- [x] No changes to CLI behavior
- [x] No changes to analysis engine
- [x] Only vcs-git change: added `export * from "./command.js"` for public `executeGit` access
