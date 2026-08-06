# Unresolved Questions

This log records blocking and non-blocking questions discovered during autonomous development.

Canonical path: `build-protocol/questions/UNRESOLVED.md`.

Template: `build-protocol/templates/UNRESOLVED_QUESTIONS_TEMPLATE.md`.

## Blocking Questions

- 2026-08-06, T-0120: Wave 7 implementation remains intentionally blocked on
  approval of the GCE registrar lifecycle, discovery over-limit behavior, and
  private-address default recorded in
  `planning/WAVE_7_SCALING_REDEPLOYMENT_PLAN.md`.

## Non-Blocking Questions

None as of 2026-06-27.

## Resolved In This Round

- 2026-08-06, T-0120: the human approved the Wave 7 package boundaries,
  explicit storage dependency and namespace for GCE discovery, GCE lease and
  refresh timings, GKE DNS refresh policy, bounded node-count policy, minimal
  GCE placement, and optional operator-configured autoscaling templates. The
  GCE registrar explanation and over-limit behavior still require confirmation.
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
