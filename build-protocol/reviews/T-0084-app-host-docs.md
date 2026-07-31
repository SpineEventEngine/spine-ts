# T-0084 Review Log

Task log: `build-protocol/tasks/T-0084-app-host-docs/TASK.md`
Branch: `task/T-0084-app-host-docs`
Baseline commit: `9d8c2c76d3c1d44abd727d9b53e54ee39a31356f`
Status: Accepted

## Canonical Concern Plan

| Concern                 | Disposition | Reason                                                                     |
| ----------------------- | ----------- | -------------------------------------------------------------------------- |
| Style/maintainability   | Required    | Framework ownership and example structure change                           |
| Documentation           | Required    | Every package README/reference and public claim changes                    |
| TypeScript/API docs     | Required    | A new public application-hosting contract and snippets are introduced      |
| Performance/reliability | Required    | Listener lifecycle, rollback, shutdown, transport, and auth context change |

## Review Freeze

- Implementation checksum: `acf32dd38d0c1cf73ef2379470e007e08acaf3b2adba8cb64d2be883b1012592`.
- Baseline: `9d8c2c76d3c1d44abd727d9b53e54ee39a31356f`.
- Scope: staged T-0084 runtime, tests, Chat migration, documentation, manifests,
  and deterministic checks; review-log-only changes after this freeze do not
  alter the implementation under review.

## Reviewer Dispatches

### Style and maintainability

- Existing role: `style_maintainability_reviewer`.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: high.
- Both fields are explicit in dispatch.
- Actual result: CLEAN.
- Actual runtime metadata: self-introspection unavailable; immutable configured
  `style_maintainability_reviewer`, `gpt-5.6-terra`, high profile accepted.
- Disposition: closed. Generic hosting belongs to the framework; Chat retains
  only application policy and focused behavior tests cover the replacement.

### TypeScript and API documentation

- Existing role: `typescript_api_docs_reviewer`.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: high.
- Both fields are explicit in dispatch.
- Actual result: BLOCKING FINDINGS.
- Actual runtime metadata: self-introspection unavailable; immutable configured
  `typescript_api_docs_reviewer`, `gpt-5.6-terra`, high profile accepted.
- Finding A1: browser hosting drops the public server read/write byte limits
  (same behavior as R1).
- Finding A2: two new server README snippets fail strict TypeScript snippet
  checking because imports/declarations are not self-contained.
- Finding A3: the server reference omits the browser gateway's fixed 1 MiB
  unary admission limit and `ResourceExhausted` behavior.
- Disposition: closed after clean scoped re-review. The public Connect adapter now receives both server
  limits; focused Connect and gRPC-Web over-limit behavior tests pass. Snippets
  are self-contained and the strict checker passes. The reference documents
  the fixed 1 MiB gateway admission limit and its relationship to transport
  limits. Corrected checksum `d4cf46901b615d5280fd2cff8851e9a2e9f77f0e36258aa50a06be4855f2a609`
  was accepted by the original API reviewer.

### Performance and reliability

- Existing role: `performance_reliability_reviewer`.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: high.
- Both fields are explicit in dispatch.
- Actual result: BLOCKING FINDINGS.
- Actual runtime metadata: self-introspection unavailable; immutable configured
  `performance_reliability_reviewer`, `gpt-5.6-terra`, high profile accepted.
- Finding R1: the public browser adapter does not receive `readMaxBytes` and
  `writeMaxBytes`, so caller-selected server bounds apply only to the private
  native endpoint.
- Finding R2: `http.Server.close()` can wait forever for an uncooperative unary
  browser request, preventing native/context cleanup.
- Disposition: closed after clean scoped re-review. Browser adapter limits are propagated and tested for
  both protocols. Listener close now has a bounded forced connection drain;
  the stalled-unary close test demonstrates native resource cleanup. The retry
  path retains the original in-progress listener-close promise until its
  callback settles, so `server.listening === false` cannot bypass an active
  forced drain after an earlier subscription-close failure. Focused server
  regression passes. Final corrected checksum
  `f803e6b7e040c39c5f51c61f017f26dec7fd65fff87f92d5baede01c7b6b8afe`
  was accepted by the original reliability reviewer.

### Documentation

- Existing role: `documentation_reviewer`.
- Expected model: immutable role profile `gpt-5.6-luna`.
- Expected reasoning: medium.
- The role profile is explicit in dispatch; no model override is permitted for
  this fixed reviewer role.
- Actual result: BLOCKING FINDINGS.
- Actual runtime metadata: self-introspection unavailable; immutable configured
  `documentation_reviewer`, `gpt-5.6-luna`, medium profile accepted.
- Finding D1: six package READMEs document nonexistent package-local `build`
  scripts (core, proto, storage, transport, storage-datastore, storage-rdbms).
- Finding D2: API-doc expectations do not yet include the new public
  `BrowserServerOptions` export.
- Accepted scope: README/reference inventory and audience split passed; no
  other concrete contradiction was found.
- Disposition: closed after clean scoped re-review. Each affected README now accurately directs users to
  the repository-root `pnpm typecheck:build`; API-doc expectations include
  `BrowserServerOptions`. The original documentation reviewer confirmed the
  commands, snippets, API expectation, audience split, and limits.

## Review Wave 1 Aggregate

- Style/maintainability: clean.
- TypeScript/API: three findings.
- Performance/reliability: two findings, one shared with API.
- Documentation: two findings.
- Correction owner: original `implementer`, configured `gpt-5.6-terra` /
  medium, explicitly resumed in the same context.
- Re-review: API, reliability, and documentation only; style remains closed
  unless a correction substantively changes ownership or structure.

## Final Review Disposition

- Style/maintainability: CLEAN.
- TypeScript/API documentation: CLEAN after correction.
- Performance/reliability: CLEAN after two correction rounds.
- Documentation: CLEAN after correction.
- Reviewer runtime self-metadata was unavailable in every lane; the immutable
  explicitly dispatched role/model/reasoning profiles are the accepted
  protocol evidence.
- The pre-integration full repository gate passed 3,246 tests with 90.01%
  branch coverage. The remaining gate is verification after synchronizing with
  current `main`.
- Back-merge disposition: the only conflict combined the reviewed
  documentation-audience command with the reviewed single-TypeDoc verification
  profile. Its focused metadata test and the full 182-test integration
  preflight pass. This deterministic composition correction does not reopen a
  specialist lane.
- Final acceptance gate: `pnpm verify:release` passed 164 test files and 3,250
  tests at 90.01% branch coverage, with every shared deterministic gate clean.
