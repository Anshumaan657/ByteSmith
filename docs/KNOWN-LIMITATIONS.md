# Known limitations in Verify 0.1

Verify 0.1 deliberately prefers an explicit unknown over an invented edge or
compatibility conclusion.

- Analysis is limited to one repository and one worker.
- Dynamic imports, runtime reflection, complex dependency injection, generated
  code, and unresolved modules may be reported as unknown.
- Complex conditional, mapped, nominal, recursive, or otherwise unprovable
  TypeScript compatibility is not guessed.
- External, recursive, composed, or unresolved OpenAPI schemas may be unknown.
- OpenAPI client linkage recognizes only narrow statically provable calls.
- Jest/Vitest configuration is parsed statically and is never executed. Dynamic
  configuration and test names may be incomplete.
- “No test found” means ByteSmith found no supported evidence; it never claims
  that no test exists.
- No test execution, coverage ingestion, historical-failure ranking, automatic
  fixes, test generation, or test skipping is included.
- The Action supports `pull_request` events and is advisory; it is not a merge
  policy or security boundary.
- GitHub fork tokens may not write comments, so fork results use the job summary.
- Node's built-in SQLite API remains marked experimental by Node.js.

Deferred web, cloud, enterprise, additional-language, and cross-repository
features are listed in [MVP scope](MVP-SCOPE.md).
