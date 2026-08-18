# ByteSmith canonicalization and semantic digest

## Purpose

Canonicalization makes semantic comparison and hashing reproducible. It is not
the original manifest serialization: it produces canonical semantic bytes from
a structurally and semantically valid manifest.

## Algorithm identifier

Manifest schema `1.0.0` uses canonicalization algorithm
`bytesmith-c14n-1` and digest algorithm `sha256`.

## Runtime fields removed before canonicalization

Remove only:

- `/manifestId`
- `/generatedAt`
- `/analyzers/*/durationMs`
- `/integrity`

No field capable of changing coverage, evidence, changes, findings, tests,
unknowns, policy evaluation, waiver state, appeal state, suspension state,
dispositions, audit history, or final conclusion may be removed.

## Scalar normalization

- Strings are Unicode NFC.
- Repository-relative paths use `/`, contain no `.` or `..` segments, and never
  begin with `/`.
- Revision identifiers, IDs, commands, summaries, and evidence text are not
  case-folded.
- JSON numbers must be finite. Integer fields remain integers.
- Timestamps use RFC 3339 date-time syntax and are normalized to UTC `Z` in
  canonical bytes.

## Object normalization

Object keys are ordered lexicographically by Unicode code point after NFC
normalization. Properties with `undefined` do not exist in JSON and are not
invented. `null` is retained only where allowed by schema.

## Array normalization

Arrays that represent semantic sets are sorted by these stable keys:

| JSON path | Sort key |
|---|---|
| `/status/reasons` | `code`, then `summary` |
| `/scope/files` | `path`, then `changeType` |
| `/scope/files/*/analyzerIds` | scalar value |
| `/analyzers` | `id`, then `version` |
| `/evidence` | `id` |
| `/changes` | `id` |
| `/changes/*/evidenceIds` | scalar value |
| `/impacts` | `id` |
| `/impacts/*/sourceChangeIds` | scalar value |
| `/impacts/*/affectedComponents` | `id` |
| `/impacts/*/evidenceIds` | scalar value |
| `/tests/recommended` | `id` |
| `/tests/gaps` | `id` |
| `/unknowns` | `id` |
| `/policies` | `id` |
| `/policies/*/findingIds` | scalar value |
| `/policies/*/analysisGapIds` | scalar value |
| `/dispositions` | `id` |
| `/appeals` | `id` |
| `/waivers` | `id` |
| `/suspensions` | `id` |
| governance `auditEventIds` | scalar value |
| `/auditEvents` | `occurredAt`, then `id` |

Arrays not listed are ordered sequences and retain their order. Duplicate IDs or
duplicate scalar members are semantic-validation errors, not silently removed.

## Serialization and digest

1. Validate the original manifest structurally and semantically, except for a
   missing or placeholder digest during construction.
2. Deep-copy the manifest.
3. Remove the runtime fields above.
4. Normalize scalars, objects, and arrays.
5. Serialize as compact JSON with no insignificant whitespace and no trailing
   newline.
6. Encode as UTF-8.
7. Compute SHA-256 and encode lowercase hexadecimal.
8. Store `{ algorithm: "sha256", value: <hex> }` in
   `integrity.semanticDigest`.

Repeated canonicalization MUST be idempotent. Reordering any semantic-set array
MUST NOT change the digest. Changing any conclusion-relevant field MUST change
the digest.
