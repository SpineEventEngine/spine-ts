# T-0195 Requirements Splitter Report

## Outcome

The single Wave 13 high-risk requirements-splitting pass is complete and found
no blocker. Planning review and acceptance remain pending under the frozen
Node-native message-channel substitution in
`build-protocol/planning/WAVE_13_EXTERNAL_EVENTS_PLAN.md`. No product code was
implemented.

Execution identity: existing project `requirements_splitter`; expected and
configured profile `gpt-5.6-sol` with `high` reasoning; no child agents. The
execution surface does not expose trustworthy per-turn model self-inspection,
so actual runtime telemetry beyond the immutable dispatched role/profile is
unavailable. Both dispatch fields were explicit, satisfying H-021's acceptance
gate.

## Sources read completely

Repository requirements and architecture:

- `AGENTS.md`
- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/PROJECT_COMPLETION_PLAN.md`
- `build-protocol/planning/AGENTIC_REVIEW_REMEDIATION_PLAN.md`
- `build-protocol/TECHNICAL_SPEC.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/DECISION_LOG.md`, with the accepted decisions enumerated in
  the Wave 13 plan
- `build-protocol/tasks/T-0195-wave13-external-events/HUMAN_REQUIREMENTS.md`
- `build-protocol/tasks/T-0195-wave13-external-events/task_plan.md`
- `build-protocol/tasks/T-0195-wave13-external-events/findings.md`
- `build-protocol/tasks/T-0195-wave13-external-events/STREAM_DISPATCH.md`
- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`

Pinned JVM corpus at commit
`0779b5fa42ca5cebd0d2935fc3a3489ab47846dc`:

- every production integration, transport, context/model class in the original
  human manifest and H-021/H-022;
- `core/src/main/java/io/spine/core/Events.java` for `toExternal()`;
- exact `broker.proto`, `transport.proto`, and `event.proto`;
- `IntegrationBrokerTest`, `DomesticEventPublisherTest`,
  `ExternalMessagesTest`, `ThirdPartyContextTest`, and
  `ExternalAttributeTest`;
- all Java and Protobuf fixtures named in the plan's exact pinned-source
  section.

Current TypeScript source/tests inspected:

- Bounded Context builder, buses, registry/dispatcher, repository, generated
  handler analyzer/writer/ingestor/metadata/readiness/decorators;
- ServerEnvironment and server/context lifecycle;
- ContextTransport, RuntimeTransportBinding/routing/runtime intake;
- SignalTransport, in-process transport, ZeroMQ config/endpoints/encoding and
  native tests;
- tenant index/boundary and explicit event-origin tenant paths;
- Proto source manifest/generation/exports/checksums;
- server and Todo child-process normal-application fixtures and acceptance.

The full path inventory, checksums, exact current trace, six-column
substitution ledger, behavior/responsibility matrix, and all 22 RED designs are
kept in the durable plan rather than duplicated here.

## Decisions

- Preserve JVM's context-owned `IntegrationBroker`, separate status/config/event
  exchanges, wanted reference counting, domestic-only publication,
  external-only reception, complete Event identity, tenant propagation, and
  lifecycle.
- Keep `ContextTransport`, `RuntimeTransportBinding`, and `SignalTransport`
  outside broker authority. Their current command/event runtime work remains
  valid.
- Add the JVM-equivalent narrow `TransportFactory` message-channel facility
  through `ServerEnvironment`: memory for local/tests and explicit production
  configuration.
- Use the exact pinned Protobuf sources and binary `ExternalMessage`; current
  `event.proto` is already byte-identical.
- Use public type-only `External<T>` on the first receptor parameter as the
  smallest faithful TS port of JVM's public `@External`; generated metadata
  carries immutable domestic/external origin.
- Filter both dispatcher selection and mixed repository handlers by
  `EventContext.external`; domestic is the default.
- Use the existing explicit `TenantBoundary`/repository tenant path; add no
  global tenant state.
- Include public `ThirdPartyContext` because JVM exposes it and the human
  manifest requires explicit inspection. No alternate import abstraction.
- Preserve external state-subscription classification on its existing state
  path, but do not invent an Entity-state broker wire.
- Treat many consumers/one domain producer as documentation, not an enforced
  election.
- Supersede older remediation-plan broker retry/Inbox language with H-019.

### Resolved transport divergence

The current ZeroMQ signal adapter binds one publisher per topic and cannot
support every process publishing the singleton status/config channels; it also
uses non-Protobuf encoding for non-command/event kinds. A direct wrapper was
therefore rejected.

Human direction explicitly authorized the smallest Node channel port: reuse
the existing `ZeroMqConfig`, but keep a private per-channel endpoint directory.
Each subscriber owns a unique bound PULL endpoint and atomic manifest; each
publisher discovers live manifests and owns one dedicated PUSH connection per
subscriber, sending once to every endpoint. This supports fan-out and multiple
status/config publishers without exposing subscriber IDs, routing plans,
request/respond, manifests, sockets, paths, new public configuration, or new
wire fields to the broker.

The plan freezes FIFO per publisher/subscriber, bind-before-manifest,
manifest-removal-before-close, secure bounded parsing, dead/expired-owner
sweeping, reconnect and aggregate close. Publication settles after all current
local PUSH sends accept the message and makes no remote-ack, retry, durability,
or replay claim. If first-send delivery proves impossible without an ack/new
public setting, H-004 requires a stop rather than invention.

## Risks and controls

| Risk                                                                   | Required control                                                                                                                       |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| First ZeroMQ send is lost during connect/close                         | bind-before-manifest, retained dedicated PUSH sockets, explicit first-send native test; stop if ack/new config is required             |
| Stale crash manifests retain dead endpoints                            | bounded owner heartbeat/expiry and liveness sweep at startup/discovery; no durable-state claim                                         |
| PUSH load balancing violates fan-out                                   | one dedicated PUSH connection and send per discovered PULL endpoint                                                                    |
| Concurrent request transitions duplicate/remove publishers incorrectly | origin-keyed sets, first-add/last-remove tests, equality/withdrawal REDs                                                               |
| Mixed domestic/external handlers leak origin                           | per-handler repository filter plus dispatcher origin sets                                                                              |
| Generated registry change becomes partial                              | one owner, one registry-version advance across analyzer/writer/ingestor/fixtures/declarations                                          |
| Imported Event loses ID/context/tenant                                 | full Event inside exact Any, checksum/binary tests, clone only external flag, tenant isolation RED                                     |
| Filesystem discovery is attacked                                       | 0700 owned canonical root, digest channel dirs, exclusive 0600 atomic manifests, size/schema/path/symlink validation, sanitized errors |
| Lifecycle races leak resources                                         | serialized close, remove manifest first, drain sends, retryable aggregate cleanup, child-process cleanup assertions                    |
| Tests fake completion                                                  | genuine two-process normal apps and dependency/shortcut scan; no direct transport/EventBus forwarder                                   |
| Reliability claims exceed JVM/transport                                | document local send settlement and best-effort crash behavior; no retry/dedup/replay/election                                          |
| ThirdParty expands into generic gateway                                | implement only the exposed JVM concept and exact tenant/actor/public contract                                                          |

## Unresolved blockers

None at planning completion. The plan contains explicit H-004 stop conditions.
In particular, an acknowledgment wire/proxy/public peer configuration, an
external-state wire, or a second public declaration concept is not authorized.

## Ordered execution and acceptance

The durable plan splits T-0195 through T-0202. T-0196 commits all 22 real REDs
before product code. Contracts/transport, metadata/filtering, and harness work
then proceed under disjoint ownership; shared Proto generation, ZeroMQ ports,
context/environment lifecycle, integration, coverage, review corrections,
release verification, merge, push, and remote cleanup are serialized.

Final acceptance requires all 22 behaviors, native normal-application
cross-process proof, one complete relevant specialist wave, final security,
documentation/API/declaration convergence, at least 90% changed executable line
and branch coverage, one converged `verify:release`, post-merge verification,
successful pushes, and H-027 proof that only `origin/main` remains and no tags
remain.

## Scope confirmation

This pass authored only:

- `build-protocol/planning/WAVE_13_EXTERNAL_EVENTS_PLAN.md`
- `build-protocol/tasks/T-0195-wave13-external-events/requirements-splitter-report.md`

No production source, test, fixture, generated output, package metadata,
existing task record, decision log, or other repository file was edited.
