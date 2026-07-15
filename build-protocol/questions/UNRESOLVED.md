# Unresolved Questions

This log records blocking and non-blocking questions discovered during autonomous development.

Canonical path: `build-protocol/questions/UNRESOLVED.md`.

Template: `build-protocol/templates/UNRESOLVED_QUESTIONS_TEMPLATE.md`.

## Blocking Questions

- 2026-07-15, T-0041 / SF-013: zeromq.js 6.5.0 materializes an unlimited number
  of multipart frames before JavaScript can enforce exact framing. Choose one:
  authorize a native extension or replacement ZeroMQ receive path that proves
  pre-allocation frame-count and 8,388,608-byte aggregate enforcement across
  Subscriber, Reply, and Request; or explicitly accept the Medium/high-
  confidence same-UID local IPC denial-of-service residual. Residual acceptance
  still includes JavaScript exact-frame/aggregate defense in depth, raw-peer
  continuation tests, canonical review, and focused security re-review.

## Non-Blocking Questions

None as of 2026-06-27.

## Resolved In This Round

- 2026-06-27: No blocking or non-blocking product questions were discovered during T-0001 governance scaffold work.
