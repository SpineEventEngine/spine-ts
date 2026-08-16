# T-0201 — Wave 13 cross-process acceptance

## Objective

Close RED-22 with two separately forked normal Node applications. A producer
Bounded Context must post a domestic Event through its ordinary EventBus, and a
different process and Bounded Context must receive the complete Event through
generated external-receptor metadata and the configured ZeroMQ message-channel
adapter.

## Baselines

- Spine TS baseline: `a680ba5b8423736dc644d6c9d5e74335c2546917`.
- Pinned Spine JVM source: `0779b5fa42ca5cebd0d2935fc3a3489ab47846dc`.
- Depends on accepted T-0197c, T-0198, and T-0200 behavior.

## Ownership and execution profile

- Existing role: **implementer**.
- Explicit configured profile: `gpt-5.6-terra` / `medium` reasoning.
- Runtime self-inspection telemetry is unavailable; the immutable configured
  role/profile is the acceptance record.
- Subagent spawning is prohibited.
- Exclusive write ownership: the parent/child cross-process fixture and this
  task's durable records. Product code is out of scope unless a live run proves
  a narrowly attributable product defect and ownership is returned first.
- Other agents and human work may exist in the repository; do not revert or
  overwrite their changes.

## Acceptance

1. Two distinct child PIDs own distinct Bounded Contexts.
2. The consumer uses generated registry version 3 external handler metadata.
3. The producer posts a domestic Event through `context.eventBus().post()`.
4. Status/config wanted-event exchange causes publication; no direct transport
   publication, shared EventBus, ContextTransport, SignalTransport routing plan,
   RuntimeTransportBinding, or fixture forwarder is used.
5. The consumer observes the original Event ID, canonical type URL, payload,
   producer identity, actor/tenant context, and `EventContext.external = true`.
6. The native ZeroMQ adapter carries the flow between real processes.
7. Startup and cleanup are bounded; children, sockets, manifests, and temporary
   artifacts are stopped/removed on success and failure.
8. The same-process/in-memory acceptance remains green separately.

## Mechanical pre-audit

A read-only explorer function was dispatched with explicit
`gpt-5.6-luna` / `medium` configuration, no subagent authority, and unavailable
runtime telemetry. It confirmed that the frozen harness already has the correct
two-child topology and no forbidden shortcut. Its concrete finding is that the
child fixture supplies `StringValueSchema` as repository state metadata rather
than a valid generated entity schema, so T-0200 metadata derivation rejects
startup. The existing `wave13-origin-repository.ts` fixture is the established
pattern. The audit also recommends making the full Event proof explicit for
type URL, absent tenant/origin where applicable, and complete context identity.

## Handoff

After native GREEN evidence and focused review, the orchestrator integrates the
task from an isolated worktree, pushes `main`, removes the contained task branch,
and verifies the remote exposes exactly `main` and no tags.

## Completion evidence — 2026-08-16

- Fixture checkpoint `33fd4ed9` replaces invalid repository state metadata with
  the accepted generated projection schema pattern and strengthens full Event
  observation without changing production code.
- Transport correction `7a67a51a`, merged here as `62541618`, permits valid
  zero-byte protobuf payloads so the broker's final empty wanted-event document
  withdraws cleanly over native ZeroMQ.
- The exact RED-22 command is GREEN with two distinct child PIDs, generated
  registry v3 external metadata, normal domestic `eventBus().post()`, original
  Event identity/type/payload/context proof, bounded clean child exits, and no
  socket or manifest artifacts. Empty adapter layout directories are retained
  intentionally as transport structure, not runtime artifacts.
