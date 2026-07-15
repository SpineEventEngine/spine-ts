# Unresolved Questions

This log records blocking and non-blocking questions discovered during autonomous development.

Canonical path: `build-protocol/questions/UNRESOLVED.md`.

Template: `build-protocol/templates/UNRESOLVED_QUESTIONS_TEMPLATE.md`.

## Blocking Questions

None.

## Non-Blocking Questions

None as of 2026-06-27.

## Resolved In This Round

- 2026-07-15, T-0041 / SF-013: the human explicitly accepted the same-UID local
  IPC multipart-allocation residual for the initial release. D-0093 requires
  Buf Protobuf binary encoding for Proto signal messages, retains the 8 MiB
  per-frame hard limit, consumes only the protocol-defined prefix of at most two
  frames, ignores trailers, and defers native/upstream workaround research until
  after project completion. The residual remains documented and is no longer a
  release blocker.
- 2026-06-27: No blocking or non-blocking product questions were discovered during T-0001 governance scaffold work.
