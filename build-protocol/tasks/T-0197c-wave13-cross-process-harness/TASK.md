# T-0197c: Wave 13 Cross-Process Behavior Harness

Status: COMPLETE — acceptance harness frozen; product-green execution remains
the integration and convergence owner’s gate.

## Objective

Close the behavior-first, real Node-process proof for Wave 13 without owning
product code. RED-22 must remain a normal application path: a producer
`BoundedContext` posts a domestic event, and a distinct consumer
`BoundedContext` receives the imported event through generated external handler
metadata and the configured message-transport adapter.

## Baseline and ownership

- Branch baseline: `aaff3b4c` (`origin/main`, 2026-08-16).
- Pinned JVM baseline: `0779b5fa42ca5cebd0d2935fc3a3489ab47846dc`.
- Existing role: implementer; explicit configured profile
  `gpt-5.6-terra` / `medium`.
- Child spawning was prohibited. Runtime telemetry is unavailable; the
  immutable configured profile is the recorded acceptance evidence.
- Exclusive paths: the parent/child cross-process fixture and this task’s
  durable records. No product, generated, transport, broker, context,
  environment, Proto, or public-export path was changed.

## Acceptance evidence

The parent fixture creates two actual child Node processes with a shared,
temporary ZeroMQ adapter directory. Each child builds a normal
`BoundedContext` with a temporary discovered generated-registry root at
registry version 3. The producer sends the warm-up event and then the target
event exclusively through ordinary `eventBus().post()` behavior. The consumer
asserts the target Event ID, unpacked message payload, producer identity, and
imported `EventContext.external` flag. Parent cleanup awaits bounded orderly
close/SIGTERM/SIGKILL fallback and asserts the adapter directory is empty.

The fixture source scan forbids direct wrapper publication and alternate
routing shortcuts: `ExternalMessage`, `ContextTransport`, `forwarder`,
`externalEventSchemas`, and `addEventDispatcher` are absent from the child;
the parent also rejects the prohibited child-source forms.

On the pre-product baseline the focused test fails at the intended missing
production adapter contract, not fixture setup:

```text
producer fixture failed: Wave 13 requires
createZeroMqTransportFactory(ZeroMqConfig).
```

The temporary build prerequisite is `pnpm proto:generate && pnpm
typecheck:build:generated`; it produces ignored runtime artifacts and its
tracked volatile generation IDs were restored before this checkpoint.

## Handoff

The frozen harness is ready for the T-0197a/T-0197b/T-0200 integration path.
That owner must rerun this exact test after product integration; a passing run
is the required live cross-process acceptance evidence and is intentionally not
claimed by this behavior-first task.
