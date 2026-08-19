# T-0210a — Transport channel type-URL validation

**Status:** Review-ready

## Scope

Make both current `TransportFactory` implementations accept every canonical,
schema-derived `ChannelId.targetType` and reject malformed values consistently.

- Baseline: `bc45eae2008589daf50c9b668360ed6ea65d1e2a` (`origin/main`).
- Branch/worktree: `codex/t0210a-type-url` at `/tmp/spine-ts-t0210a`.
- Owner: existing `implementer` role, explicitly configured
  `gpt-5.6-terra` / `medium`; no subagents. Runtime telemetry is unavailable,
  so the immutable dispatch profile is the available evidence.

## Frozen contract

`TransportFactory` receives only `ChannelId`. It validates the canonical syntax
`<nonempty whitespace-free prefix>/<Protobuf full name>` without resolving a
schema or recognizing a fixed set of prefixes. The implementations retain their
existing defensive `ChannelId` copies and lifecycle behavior.

No public API, Proto, configuration, registry, or transport concept is added.

## Acceptance evidence

- RED: the shared conformance test rejected
  `type.spine.examples.todo/spine.examples.todo.TaskCreated` in the in-memory
  factory before product code changed.
- GREEN: the same test executes against both in-memory and ZeroMQ factories;
  it accepts the custom type URL and rejects empty, whitespace-bearing,
  prefix-less, type-less, and doubled-separator values.
- Focused suite: conformance, in-memory, and ZeroMQ manifest tests.
- Required mechanical gates: generated build, tooling typecheck, lint, format,
  documentation checks, diff hygiene, and changed-code coverage.

## Ownership boundary

This task owns only transport message-channel validation, its conformance/unit
tests, and these durable records. It does not change the T-0210 external-event
fixture, IntegrationBroker semantics, or deployment behavior.
