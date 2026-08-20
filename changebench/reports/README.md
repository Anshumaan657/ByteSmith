# ChangeBench reports

Generated local and CI reports use the versioned `ChangeBenchReport` format
exported by `@bytesmith/changebench`. Reports contain aggregate metrics,
per-case diagnostics, and tag/capability segments. Generated JSON reports are
runtime artifacts and should not be committed unless intentionally promoted to
`../baselines/` after review.
