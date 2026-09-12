# Verify 0.1 release process

Releases are immutable GitHub source releases. The CLI is built from the pinned
workspace lockfile; the Action ships its committed self-contained bundle.

1. Start from a clean, up-to-date `main` branch on Node.js 24.
2. Run `corepack pnpm install --frozen-lockfile` and `corepack pnpm check`.
3. Rebuild the Action with
   `corepack pnpm --filter @bytesmith/github-action bundle` and verify that no
   uncommitted bundle change remains.
4. Run the release audit. Automated gates must pass; repository and human gates
   must be backed by completed, reviewable evidence.
5. Confirm package versions, action metadata, schema versions, documentation,
   known limitations, and release notes agree.
6. Create an annotated `v0.1.0` tag from the reviewed main commit and push the
   tag. Never move an existing release tag.
7. Create a GitHub release from that tag with `CHANGELOG.md`, supported runtime,
   installation instructions, and the commit SHA.
8. Verify the Action from a separate test repository using the immutable tag or
   commit SHA. Keep the `continue-on-error: true` advisory contract.

Internal workspace packages remain private implementation units in 0.1; they
are not independently published to npm. A later public package release requires
an explicit dependency/public-API review and provenance-enabled publishing.

If any required gate fails after tagging, publish a new patch tag. Do not alter
the old tag or conceal the failed evidence.
