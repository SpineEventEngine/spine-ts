# Unresolved Questions

This log records blocking and non-blocking questions discovered during autonomous development.

Canonical path: `build-protocol/questions/UNRESOLVED.md`.

Template: `build-protocol/templates/UNRESOLVED_QUESTIONS_TEMPLATE.md`.

## Blocking Questions

None recorded. On 29 September the human resolved field selection: no masking
in any API, including subscriptions; ignore mask fields in incoming Protobufs.
Implementation is still pending.

## Non-Blocking Questions

None as of 2026-06-27.

## Resolved In This Round

- 2026-09-29, masking: remove it from all APIs, including subscriptions, rather
  than choose different mask behavior for Entity and state results. `find()`
  returns complete Entities; `findStates()` returns complete state messages.
  Remove existing masking APIs and execution support, not merely the new DSL
  option. Ignore mask fields in incoming Protobufs instead of applying or
  rejecting them. The next requested step is plan reanalysis, not implementation.
- 2026-09-29, repository queries and generated DSL: routing searches only the
  receiving repository. More than 1,000 distinct final recipients produces a
  console warning in routing, never a rejection or a warning in find methods.
  Provide `findIds(query)`, `findStates(query)` and `find(query)` returning actual
  Entity instances. Generate a JVM-like typed DSL through the normal model
  workflow and register columns automatically when its module is imported.
  Application code must not manually register columns. See the extension in
  planning/cross-context-queries.md for the complete approved requirements.
- 2026-09-28, cross-context queries: search only contexts in the same Server;
  duplicate Entity registration is an error; preserve the current effective
  tenant and reject an incompatible destination before reading. Single-tenant
  execution uses `SINGLE_TENANT`, never a tenant-free mode. No tenant-switching
  API or remote discovery is requested. The standalone plan review found no
  further product choices. See planning/cross-context-queries.md.
- 2026-09-28, Entity dependency configuration: the human chose to advance only
  `snapshot` automatically and leave `latest` unchanged. This replaces the
  earlier two-tag requirement and closes the manual second-tag question.
  Existing publication code already implements this policy; no stored token,
  manual tag update, or live registry change is needed.
- 2026-08-06, T-0120: Wave 7 Q&A is complete. Each GCE application process
  maintains its own leased registration; private addresses are the default;
  and the Gateway continues serving every discovered node when the configured
  expected count is exceeded. Wave 8 emits the corresponding ERROR log. No
  Wave 7 product question remains before final plan approval.
- 2026-08-06, T-0120: the human approved the Wave 7 package boundaries,
  explicit storage dependency and namespace for GCE discovery, GCE lease and
  refresh timings, GKE DNS refresh policy, bounded node-count policy, minimal
  GCE placement, and optional operator-configured autoscaling templates.
- 2026-07-27, T-0074: Wave 4 Q&A is complete. The human approved the browser,
  client packaging, React, best-effort subscription, standalone authentication
  gateway, application-session, Google/GitHub/OIDC, context-resolution,
  Envoy-reference, Chat Projection, TS/JVM interoperability, documentation,
  and later-wave boundaries recorded in D-0103 through D-0105 and
  `WAVE_4_BROWSER_CLIENT_INTEROPERABILITY_PLAN.md`. No Wave 4 product question
  remains open.
- 2026-07-15, T-0041 / SF-013: the human explicitly accepted the same-UID local
  IPC multipart-allocation residual for the initial release. D-0093 requires
  Buf Protobuf binary encoding for Proto signal messages, retains the 8 MiB
  per-frame hard limit, consumes only the protocol-defined prefix of at most two
  frames, ignores trailers, and defers native/upstream workaround research until
  after project completion. The residual remains documented and is no longer a
  release blocker.
- 2026-06-27: No blocking or non-blocking product questions were discovered during T-0001 governance scaffold work.
