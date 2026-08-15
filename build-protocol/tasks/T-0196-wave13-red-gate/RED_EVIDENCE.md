# T-0196 Failing-Before Evidence

Baseline: `c1b45018fb404129df56843b0e31e15470b7a947`

Status: COMPLETE RED BASELINE — final test/evidence correction verified

Command (2026-08-15):

```sh
pnpm exec vitest run packages/proto/test/integration-broker-contract.test.ts packages/transport/test/message-transport-conformance.test.ts packages/server/test/handler/external-origin.test.ts packages/server/test/integration/integration-broker.test.ts packages/server/test/integration/third-party-context.test.ts packages/server/test/server/server-integration-broker-lifecycle.test.ts packages/server/test/server/server-integration-broker-cross-process.test.ts --reporter=dot
```

Observed result: 7 test files failed with exactly 22 named RED cases. No case
timed out or exposed an unrelated baseline failure. RED-07–12 now fail at the
missing `IntegrationBroker` module before their real context/factory scenarios,
RED-14 at the absent generated schemas, RED-18 at the absent environment
transport-factory field, RED-20 at absent `ThirdPartyContext`, and RED-21 at
the absent in-memory factory. RED-22 starts two normal
child processes using a shared temporary IPC directory; both report the
specific missing `createZeroMqTransportFactory(ZeroMqConfig)` contract through
IPC, and parent cleanup terminates both processes and removes that directory.

Every broker RED continues after dynamic contract discovery with a real
producer `BoundedContext`, a consumer `BoundedContext`, an external dispatcher
declared through the frozen optional `externalEventSchemas()` subset, normal
`eventBus().post()` publication, and recorded-receptor delivery assertions.
Thus an empty exported broker class remains RED rather than satisfying the
gate; baseline stops first at the missing broker module.

| RED | Named executable case                                                                                                                                | Expected missing baseline behavior              | Observed failure                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 01  | `delivers one requested domestic event once between two same-process contexts`                                                                       | Context-owned broker / same-process delivery    | Missing `integration/integration-broker.js` contract assertion                             |
| 02  | `fans one producer event out to every requesting consumer`                                                                                           | Broker fan-out                                  | Missing `IntegrationBroker` contract assertion                                             |
| 03  | `excludes imported events from a domestic receptor`                                                                                                  | Generated registry v3 origin metadata           | Registry source remains `readonly version: 2`                                              |
| 04  | `excludes domestic events from an external receptor`                                                                                                 | External origin filtering metadata              | Registry source has no `origin: "external"`                                                |
| 05  | `does not export an unrequested domestic event`                                                                                                      | Wanted-type publisher selection                 | Missing `IntegrationBroker` contract assertion                                             |
| 06  | `does not republish imported events in a bidirectional cycle`                                                                                        | Origin-only loop prevention                     | Missing `IntegrationBroker` contract assertion                                             |
| 07  | `installs one publisher on the first requester and serializes complete-set replacement`                                                              | First-requester registration                    | Missing `IntegrationBroker` contract assertion                                             |
| 08  | `retains publication while another requester still wants the type`                                                                                   | Reference-counted wanted sets                   | Missing `IntegrationBroker` contract assertion                                             |
| 09  | `removes publication after the final requester withdraws without losing the prior set on failure`                                                    | Final withdrawal / rollback                     | Missing `IntegrationBroker` contract assertion                                             |
| 10  | `suppresses an unchanged complete wanted-event set`                                                                                                  | Config equality suppression                     | Missing `IntegrationBroker` contract assertion                                             |
| 11  | `rebroadcasts an unchanged wanted-event set after a peer comes online`                                                                               | Status-triggered rebroadcast                    | Missing `IntegrationBroker` contract assertion                                             |
| 12  | `publishes an empty wanted set before consumer teardown`                                                                                             | Close withdrawal ordering                       | Missing `IntegrationBroker` contract assertion                                             |
| 13  | `preserves per-producer order, complete Event bytes, and EventId`                                                                                    | Exact ordered event exchange                    | Missing `IntegrationBroker` contract assertion                                             |
| 14  | `preserves the exact ExternalMessage wrapper and ChannelId contracts`                                                                                | Generated broker/transport Protobuf exports     | Missing all four planned schema exports                                                    |
| 15  | `validates the existing tenant boundary and isolates imported tenants`                                                                               | Tenant-aware broker intake                      | Missing `IntegrationBroker` contract assertion                                             |
| 16  | `changes only EventContext.external before posting through the normal EventBus`                                                                      | Normal EventBus import adapter                  | Missing `IntegrationBroker` contract assertion                                             |
| 17  | `rejects external command receivers while retaining external event command methods`                                                                  | Canonical type-only `External<T>` marker        | Analyzer reports ordinary invalid-signal diagnostics, not the external-command model error |
| 18  | `gives every BoundedContext one broker that withdraws, detaches, closes, aggregates failures, and supports retry cleanup`                            | Environment message transport lifecycle setting | `server-environment.ts` has no `TransportFactory`                                          |
| 19  | `emits first-parameter External<T> origin metadata and rejects untrusted shapes`                                                                     | Canonical first-parameter marker                | Analyzer omits the marked handler/origin and accepts one non-canonical shape               |
| 20  | `classifies every supported external receptor, keeps system/state subsets out of wanted documents, and preserves ThirdPartyContext import semantics` | Receptor origin plus `ThirdPartyContext`        | Server root has no `ThirdPartyContext` export                                              |
| 21  | `gives memory and ZeroMQ factories one typed channel, fan-out, stale, FIFO, and close contract`                                                      | Type-only message-channel SPI                   | Missing `memory/message-transport.js` contract assertion                                   |
| 22  | `delivers a domestic Event across two configured application processes without a forwarding shortcut`                                                | Production-capable broker discovery/delivery    | Child IPC reported missing `createZeroMqTransportFactory(ZeroMqConfig)`                    |

RED-07–12 use a recording/delegating `TransportFactory` configured through
`ServerEnvironment`; no `IntegrationBroker` test API or direct transition
application remains. Their post-contract assertions decode the planned wrapped
config frames rather than treating a broker frame as a wanted document. RED-14
uses descriptor fields and binary EventId/Event/Any round-tripping plus the
planned external-message unpack path; JSON is not asserted as broker-wire
proof. RED-18 uses injected close failures to specify aggregate cleanup and
retry behavior. RED-20 builds a temporary generated v3 registry from the
canonical entity-descriptor fixture; its external state-subscription uses an
entity schema and is excluded from decoded wanted documents before the test
reaches its `ThirdPartyContext` contract gate. RED-22 uses two normal
`BoundedContext` applications, configured through
`createZeroMqTransportFactory(ZeroMqConfig.create(...))`, and a discovered
version-3 generated registry plus direct entity registration. Its child fixture contains
no direct transport publication, `ExternalMessage`, direct consumer EventBus
post, `ContextTransport`, or forwarder shortcut; the test scans those
exclusions and asserts full downstream event identity after delivery.

RED-21’s native branch specifies the frozen adapter-private manifest contract:
the `spine-message-channels` root, SHA-256 channel directory, v1 six-key
manifest, 4096-byte bound, malformed/symlink rejection, and foreign
adapter-identity retention. Both RED-22 children receive one shared adapter
identity rather than role-derived identities.

## Correction Verification

After the consolidated specialist-review batch, the same command was rerun on
2026-08-15. It again reported exactly 22 named failures. The corrected RED-03
and RED-04 now query the canonical type URL and fail specifically because the
registry still lacks origin-aware filtering; RED-06 contains both domestic and
opposite external declarations so each context can import the other’s event
without a re-export path. RED-15 now asserts each tenant value and the imported
`external` flag. RED-22’s normal child applications now report the received
event ID, unpacked payload, imported external flag, and producer ID unpacked
from the received Event context; shutdown waits for a clean child exit and
retains the bounded SIGTERM fallback. Temporary generated-registry modules,
their global slots, and directories are removed during fixture shutdown.

Static fixture validation after that run succeeded:

```sh
pnpm exec tsc --noEmit -p tsconfig.json
node --check packages/server/test/server/server-integration-broker-child.mjs
pnpm exec prettier --check <all T-0196 test and fixture files>
git diff --check
```

The post-review orchestration correction run on 2026-08-16 again reports
exactly 22 named failures. Temporary compile-consumer projects now prove the
type-only/public contracts and clean themselves in `finally`. RED-06 counts
event-channel frames to detect re-export; RED-09 injects a publication failure
to retain the prior wanted set; RED-18 uses two contexts and decodes the wrapped
empty withdrawal; RED-21 sends typed `ExternalMessage` frames and covers live,
pruned, restarted, foreign-identity, and bounded manifest discovery. RED-22
uses a normally published warm-up Event as its discovery readiness handshake,
then asserts the complete target Event, awaits clean exits, and checks that no
manifest/socket artifact remains before fallback fixture-directory removal.

The final correction run on 2026-08-16 retained exactly 22 named failures and
added the remaining reviewer-requested behavioral boundaries: generated
mixed-origin repository dispatch, concurrent same-origin wanted-set
replacement, partial publisher-acquisition rollback, per-tenant Stand state,
full pre-existing `EventContext` equality except for `external`, self/paired
System origin rejection, exact required/literal TypeScript contracts, UUID
control-message IDs, invalid wrapper-ID rejection, JSON/V8 decode rejection,
native attempt-all aggregation with a live peer, repeated endpoint-generation
replacement with one visible live manifest/socket, complete adapter-directory
removal, and bounded SIGTERM/SIGKILL child cleanup.

The final TypeScript/API, style/maintainability, and performance/reliability
re-reviews passed with no remaining findings.
