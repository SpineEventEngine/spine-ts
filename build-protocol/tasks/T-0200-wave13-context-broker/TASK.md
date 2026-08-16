# T-0200 — Wave 13 context, environment, tenant, and ThirdParty integration

## Baseline and risk

- Spine TS baseline: `e56b93bea39e02f6e06f9a8c392aaf8e04f4be2c`.
- Pinned Spine JVM baseline: `0779b5fa42ca5cebd0d2935fc3a3489ab47846dc`.
- Classification: high-risk shared runtime and public API integration.
- Durable design authority:
  `build-protocol/planning/WAVE_13_EXTERNAL_EVENTS_PLAN.md`.

## Ownership

One lifecycle **implementer** owns this task's production and behavior-test
changes. The explicitly configured profile is `gpt-5.6-terra` / `medium`.
Runtime self-introspection is unavailable on this surface, so the immutable
configured role/profile is the available telemetry. The implementer may not
spawn subagents and is not alone in the repository; it must preserve all other
work and must not touch the primary checkout.

Owned surfaces are `packages/server/src/context/bounded-context.ts`,
`packages/server/src/server-environment.ts`, the smallest necessary internal
broker/tenant readiness extensions, public `ThirdPartyContext`, server root
exports/API inventory, directly affected lifecycle tests, and the T-0196
same-process acceptance fixtures. No other task owns overlapping files while
this task is active.

## Acceptance

- Every built Bounded Context creates, opens, and closes exactly one internal
  IntegrationBroker; no public broker accessor or application singleton exists.
- `ServerEnvironment` owns the distinct typed `TransportFactory`: local/test
  resolution defaults to `InMemoryTransportFactory`; production requires an
  explicit factory; close order and retry behavior remain observable.
- Only generated external domain-event schemas become wanted interests.
  Imported events use the existing tenant execution seam and normal EventBus,
  preserve the complete original Event, and change only
  `EventContext.external`.
- Close withdraws interests, detaches broker observations, drains accepted work,
  and closes broker resources before environment transport teardown.
- Public `ThirdPartyContext` exactly implements the frozen single/multitenant,
  actor, producer identity, broker-only publication, `isOpen`, and idempotent
  asynchronous close contract. No alternate import abstraction is added.
- T-0196 RED-01 through RED-21 become green where they exercise integrated
  same-process behavior. RED-22 remains exclusively owned by T-0201.
- No `ContextTransport`, `RuntimeTransportBinding`, or `SignalTransport`
  dependency enters the broker path; no retry/dedup/inbox/election concept or
  serialized field is added.
- Focused tests, generated build, lint/format/diff, API docs, and at least 90%
  changed executable line and branch coverage pass before specialist review.
