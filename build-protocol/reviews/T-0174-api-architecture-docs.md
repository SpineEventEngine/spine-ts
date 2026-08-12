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

## Accepted review batch and correction disposition

- Documentation/API P2, accepted and corrected: client and deployment handoff
  rows now have one canonical reference per subject rather than directing a
  combined subject to one incomplete reference.
- Documentation/API P2, accepted and corrected: `@Where` now states its
  event/rejection-consuming handler scope, one-filter limit, literal input
  requirements, and fail-closed behavior. The build-time analyzer is the
  source-backed evidence.
- Performance/reliability: CLEAN; the correction changes only navigational and
  API documentation claims. Style and security remain N/A for the previously
  recorded concrete reasons.
- The configured roles/profiles remain the available metadata; this surface
  exposes no runtime self-introspection and reports no mismatch or fallback.

## Correction evidence

- Passed explicit snippets for both documents, API/audience, canonical-link and
  retired-routing scans, copyright, release-readiness links, format/diff, and
  `pnpm verify:task -- --no-tests`.
- Documentation and TypeScript/API P2 findings are CLEAN after correction;
  performance/reliability remains CLEAN. Style and security retain their N/A
  dispositions. No reviewer dispatch or runtime/test classification change was
  required.

## Final closure correction

- The former combined local/remote delivery mapping was split into distinct
  canonical client/remote and local in-memory server targets in both documents.
- Documentation and TypeScript/API remain CLEAN after this deterministic
  mapping correction; performance/reliability remains CLEAN. No new review
  dispatch is required.
- Final mapping evidence: strict snippets, API/audience, exact mapping scan,
  release-readiness links, copyright, formatting, and diff checks pass. This
  narrow record/doc correction does not require another task verification
  profile.
