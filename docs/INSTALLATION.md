# Install ByteSmith Verify 0.1

## Prerequisites

- Git
- Node.js 22.13 or newer (Node.js 24 is used in CI and by the Action)
- Corepack

## Local CLI from a release

Clone the immutable Verify 0.1 tag, install exactly the locked dependencies,
build, and run the CLI through the workspace:

```bash
git clone --branch v0.1.0 --depth 1 https://github.com/Anshumaan657/ByteSmith.git
cd ByteSmith
corepack prepare pnpm@11.19.0 --activate
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm --filter bytesmith exec bytesmith doctor --repository /path/to/project
```

ByteSmith needs no account, network service, AI key, or cloud database. The
analysis itself is offline after installation.

## Repository setup

Run `init` once, inspect the generated configuration, then analyze exact Git
revisions:

```bash
corepack pnpm --filter bytesmith exec bytesmith init --repository /path/to/project
corepack pnpm --filter bytesmith exec bytesmith analyze \
  --repository /path/to/project --base origin/main --head HEAD \
  --format json --output reports/impact.json
```

For pull requests, follow [the GitHub Action guide](GITHUB-ACTION.md).

## Troubleshooting

- Run `bytesmith doctor` first; it checks Git, Node, configuration, SQLite,
  analyzers, and test discovery.
- Run from a clean Git worktree and ensure both comparison commits exist.
- Use a full clone when merge-base resolution reports missing history.
- Delete only the configured local cache database if `doctor` reports that it
  quarantined corruption; manifests remain immutable files.
- Treat `incomplete` and `error` as visible analysis limits, never as a clean
  result. See [known limitations](KNOWN-LIMITATIONS.md).
