# Phase 4A review checklist

## Review command

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

## Exit-gate evidence

- [x] TypeScript and JavaScript discovery lives in
      `@bytesmith/contracts-typescript`, the workspace responsible for Compiler
      API analysis.
- [x] Repository traversal is deterministic and excludes source-control
      metadata and dependency installation directories.
- [x] Project and package identities are scoped by the stable Phase 3
      repository ID; absolute checkout paths never participate in identity.
- [x] Symbolic filesystem entries are not followed and remain visible through
      a structured warning.
- [x] `tsconfig.json` and `jsconfig.json` files are discovered recursively.
- [x] TypeScript's configuration parser resolves inherited compiler options,
      include/exclude/files membership, and project references.
- [x] Relative configuration inheritance is recorded as repository-relative
      paths without absolute host paths.
- [x] JavaScript configurations default to `allowJs` while retaining explicit
      `checkJs` behavior.
- [x] Source membership distinguishes TypeScript, JavaScript, mixed, and empty
      projects.
- [x] Compiler-option summaries include module mode, module resolution, target,
      JSX mode, strictness, declaration/composite settings, repository-relative
      directories, and deterministic path aliases.
- [x] npm array/object workspaces, pnpm workspace packages, and Yarn workspaces
      are discovered without network access.
- [x] Basic `*`, `**`, `?`, brace, and exclusion workspace patterns are
      evaluated against repository-relative package directories.
- [x] Package boundaries include stable identity, manifest path, workspace
      membership, package name/version/type, entry points, and exports.
- [x] The workspace-root package remains a package boundary but is not
      misclassified as a workspace member.
- [x] Projects bind to their nearest containing package boundary.
- [x] Duplicate workspace names, malformed definitions, missing references,
      invalid configurations, and files outside the repository produce explicit
      diagnostics and an `incomplete` result.
- [x] Repeated discovery produces deeply equal, host-independent output.
- [x] The existing TypeScript path-alias ChangeBench fixture is discovered with
      the expected source membership and alias configuration.
- [x] ByteSmith discovers its own 17-member workspace, 18 package boundaries,
      and 20 TypeScript project configurations without diagnostics.
- [x] Empty repositories produce an explicit successful empty result; missing
      repositories fail with a stable typed error.
- [x] Tests use temporary repositories and do not depend on time, network,
      directory iteration order, or platform shell syntax.

## Phase boundary

Phase 4A discovers project topology and parsed configuration. It does not yet
construct reusable TypeScript `Program` objects, resolve import targets, extract
symbols or signatures, build call/reference relationships, or compare base and
head symbols. Those responsibilities remain in Phases 4B–4D. Phase 4E will add
end-to-end analyzer containment, performance limits, canonical integration, and
the remaining ChangeBench verification.

## Reviewer decision

- [ ] Approve Phase 4A and merge the pull request.
- [ ] Request changes before merge.
