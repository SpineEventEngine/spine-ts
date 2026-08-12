# T-0174 API/Architecture Documentation Review

Status: Implementation in progress; review not started

The task Human-Imposed Requirements Ledger is binding.

## Assignment profiles

- Implementation: existing `implementer`, explicit `gpt-5.6-terra` / medium.
- Documentation review: existing immutable `documentation_reviewer`, configured
  `gpt-5.6-luna` / medium.
- TypeScript/API documentation review: existing
  `typescript_api_docs_reviewer`, explicit `gpt-5.6-terra` / high.
- Performance/reliability review: existing
  `performance_reliability_reviewer`, explicit `gpt-5.6-terra` / high.
- Style/maintainability is N/A unless shared checker implementation changes.
- Security is N/A unless a trust-boundary claim or implementation changes.

The execution surface does not expose separate runtime-profile metadata. The
immutable configured roles and explicit dispatch profiles are accepted unless
the surface reports a mismatch or fallback.

## Pending evidence

- Two-document disposition and canonical-target map.
- Strict snippets, API/audience, retired-routing scan, links, formatting,
  licensing, diff, and selected task verification.
- One complete specialist review wave and one consolidated correction batch.

## Implementation disposition

- `docs/api/README.md`: changed. It remains the TypeDoc/public-API index and
  now hands each cross-package topic to one detailed source rather than adding
  a second tutorial.
- `docs/architecture/README.md`: changed. It remains the canonical runtime and
  Bounded Context explanation, with deliberate onward references for server,
  client recovery, storage/tenancy, delivery, and deployment.
- TypeScript routing is source-verified as exact `route()` plus
  `replaceDefault()` declarations on `CommandRouting`, `EventRouting`, and
  `StateUpdateRouting`. Java-specific options are described only as preserved
  wire definitions. `@Route` and `routeSemantic()` are not TypeScript APIs.
- Style is N/A because no shared checker/tooling changes. Security is N/A
  because no trust-boundary implementation changed; existing single-Gateway
  and Cloud Run exclusions are retained in the architecture facts.

## Deterministic preflight

- Passed generated build, strict snippets for the two owned documents, API and
  audience checks, canonical-target/retired-routing scan, copyright,
  release-readiness links, format, and diff checks.
- Passed `pnpm verify:task -- --no-tests`; runtime tests are N/A because the
  milestone changes documentation and durable records only.
- Documentation, TypeScript/API, and performance/reliability remain pending
  the recorded specialist review wave. Style and security retain their concrete
  N/A dispositions above.
