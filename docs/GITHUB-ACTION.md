# ByteSmith Verify GitHub Action

ByteSmith runs the same exact-revision engine used by the CLI and posts one
advisory pull-request report. Verify 0.1 does not block merging.

## Installation

Create `.github/workflows/bytesmith.yml` in the repository being analyzed:

```yaml
name: ByteSmith Advisory
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
  pull-requests: write
concurrency:
  group: bytesmith-${{ github.event.pull_request.number }}
  cancel-in-progress: true
jobs:
  advisory:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          ref: ${{ github.event.pull_request.head.sha }}
      - uses: Anshumaan657/ByteSmith/apps/github-action@v0.1.0
        continue-on-error: true
        with:
          publish: ${{ github.event.pull_request.head.repo.full_name == github.repository }}
```

Pin a full commit SHA instead of a tag when the consuming repository requires
strict supply-chain immutability.

## Safety behavior

- Full Git history is required because ByteSmith resolves the merge base.
- The checkout must equal the event's exact head commit.
- A force-push or rebase cancels the older workflow. Before publication,
  ByteSmith asks GitHub for the current head again and refuses stale output.
- Fork pull requests are analyzed with read-only permissions. Their result is
  retained in the job summary because the workflow does not publish with an
  untrusted fork token.
- `SIGINT` and `SIGTERM` cancel the shared analysis engine and its worker.
- Permission and reporting failures fall back to the job summary.
- `continue-on-error: true` keeps the Verify 0.1 integration advisory even when
  startup or a required analyzer fails. The action output still reports the
  real conclusion and stable error code.

## Inputs and outputs

`action.yml` is the authoritative input/output contract. In normal use, leave
`base` and `head` unset so the immutable values come from the pull-request
event. `config`, `database`, and `use-cache` match the local engine. The useful
outputs are `conclusion`, `semantic-digest`, the three comparison revisions,
`error-code`, and `report-state`.

## Troubleshooting

- `shallow_repository`: set `fetch-depth: 0`.
- `stale_revision` or `stale_analysis`: allow the newly triggered workflow to
  finish after the latest force-push or rebase.
- `dirty_repository`: run ByteSmith before build steps that modify the checkout.
- `permission_denied`: grant `pull-requests: write`, or use summary-only fork
  behavior.
- `unsupported_event`: Verify 0.1 supports `pull_request` only.
- `invalid_configuration`: run `bytesmith doctor` locally and validate
  `.bytesmith/config.json`.
