# M03 read and subscription baseline map

Read-only source inventory at checkpoint `3227be3ac` in
`/Users/armiol/.codex/worktrees/app-queries-read-filters/spine-ts`. Assignment:
orchestrator-dispatched source-scanning function, explicitly configured
`gpt-6-luna` / `low`; runtime introspection unavailable. M02 implementation was
active, so this scan ran no build, generation, or tests and made no source
changes. This is a code/test-path inventory, not a new architecture decision.

## Existing admission and status flow

| Surface              | Current implementation                                                                                                                                                                                                                                                                                                                                                   | Existing gap relevant to M03/M04                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Query RPC            | `packages/server/src/services/spine-services.ts:252-263` registers Read; `:367-384` resolves target, does manual criteria/format validation, then reads. Unsupported target and semantic validation become successful `QueryResponse` values with error statuses, via `:1064-1081`; tenant mismatch also becomes an in-response error at `:394-415`.                     | Declared Proto constraints are not run on the complete Query. Storage/read exceptions are swallowed into `QUERY_READ_ERROR` (`:405-416`). Keep the existing semantic checks, but migrate invalid input to `INVALID_ARGUMENT` + structured Spine Error and unexpected read failures to sanitized `INTERNAL`. Tenant statuses must retain their specific meaning. Valid empty reads already produce an OK response at `:436-439`. |
| Topic Subscribe      | `spine-services.ts:448-477` routes first, then calls manual `validateTopic` and `createSubscriptionShape` before registry creation, checks tenant membership, and creates the record. The router is registered at `:258-262`.                                                                                                                                            | Manual admission is partial and its `ConnectError`s generally only carry a message/status. Add complete detached Topic validation before routing/registry side effects and structured `INVALID_TOPIC` / `UNSUPPORTED_TOPIC_TARGET`; retain tenant/auth distinctions.                                                                                                                                                            |
| Activate             | `spine-services.ts:479-505` returns normally when Subscription ID is absent or `#activationRecord` has no record. `:513-535` performs registry lookup; `:544-568` maps `missing`, `expired`, closed, and already-active paths to no attached record.                                                                                                                     | Validate the complete Subscription before lookup. For a well-formed missing/expired ID return `NOT_FOUND` / `UNKNOWN_SUBSCRIPTION`; preserve duplicate-active behavior as a distinct path.                                                                                                                                                                                                                                      |
| Cancel               | `spine-services.ts:594-615` returns OK when ID is missing; unknown ID calls removal and returns OK.                                                                                                                                                                                                                                                                      | Validate complete Subscription before cancellation mutation, but keep well-formed unknown cancellation idempotently successful.                                                                                                                                                                                                                                                                                                 |
| Native forwarding    | Auth native service maps Read to authenticated unary forwarding at `packages/auth/src/native/index.ts:494-497,611-625`. `NativeGatewayValues.publicError` removes backend wire protocol headers while returning the same ConnectError and its typed details (`:528-547`). `unaryError` maps gateway rejections to a new ConnectError without Spine details (`:775-793`). | Verify an application Spine Error survives a native round trip, including enum type, numeric code, packed validation detail, and `spine-error-bin`; ensure sanitized gateway/service errors expose no backend secrets. The native adapter tests live in `packages/auth/test/native-gateway-services.test.ts` and `native-relay.test.ts`.                                                                                        |
| Gateway forwarding   | `packages/auth/src/gateway/index.ts:304-329` resolves trusted context, rewrites request context, forwards bytes, and returns the forwarded result. `packages/auth/src/gateway/dynamic-unary-forwarder.ts:208-212,332-338` forwards and preserves ordinary errors, only translating membership lifecycle errors.                                                          | Existing structure should preserve a forwarded status-bearing error; add round-trip coverage at this boundary rather than collapsing it into an in-response Query error.                                                                                                                                                                                                                                                        |
| App-node Coordinator | `packages/server/src/server/node-coordinator.ts:432-440` sends Query and receives a `QueryResponse`; `:885-910` forwards native unary responses and copies response metadata. Query errors currently represented inside the response can therefore look successful at this hop.                                                                                          | Once service emits transport errors, ensure `ConnectError` status/details propagate through Coordinator forwarding; no conversion to empty response.                                                                                                                                                                                                                                                                            |
| Browser client       | `packages/client-web/src/client/client.ts:908-926` clones Query, supplies actor context, then directly calls QueryService.Read; transport errors reject to caller. Subscription retry classification is at `:1780-1793`; only structured `TENANT_UNKNOWN` NotFound is explicitly terminal today.                                                                         | Add browser tests for Connect typed error details and update invalid-Query callers that currently inspect `QueryResponse.response.status`. Broader unknown-activation classification belongs to M04.                                                                                                                                                                                                                            |

The authoritative status and error matrix is in `PROPOSAL.md:600-644`; the
specific unknown-activation/cancel rules and M04 recovery contract are at
`:646-663`. In particular Query invalid input is `INVALID_ARGUMENT` with
`INVALID_QUERY` or `UNSUPPORTED_QUERY_TARGET`; unexpected technical failures
are sanitized `INTERNAL`; malformed Topic/Subscription inputs have their own
error types; missing/expired activation is `NOT_FOUND` with
`UNKNOWN_SUBSCRIPTION`; unknown Cancel remains OK. Command Ack semantics and
existing tenant/auth/decode/size statuses remain separate.

## Focused test inventory

The existing service suite is the central migration surface:
`packages/server/test/services/spine-services.test.ts`.

- Real gRPC Query success and in-response invalid filter assertion:
  `:440-524` (especially `:516-520`). Convert the invalid-filter assertion to
  expect a ConnectError and inspect Spine details.
- In-response unsupported/empty criteria assertions:
  `:904-958`; this exercises no target and empty TargetFilters (`:922-945`).
  Preserve direct-boundary zero-read assertions where available, moving expected
  result from response status to the rejected RPC.
- Semantic format tests still consume response errors:
  `:1181-1191`, `:1334-1364`, plus the `responseErrorMessage` assertions around
  `:1383-1389`, `:1437-1501`, `:1524-1643`, and `:1736-1741`.
- Technical read failures expected as in-response `Query read failed.`:
  `:1744-1772` and tenant read-failure matrix `:1280-1332`. Change unexpected
  failures to expect sanitized INTERNAL and verify storage details do not leak.
- Query tenant mismatch in-response checks:
  `:2557-2592`, with further direct-handler variants at `:2594-2660`. Keep
  tenant behavior distinct from invalid Proto input.
- Subscription malformed Topic and pre-side-effect checks:
  `:3076-3100`, `:3302-3377`, and real-gRPC unsupported/malformed cases
  `:4314-4422`.
- Existing absent-ID activation/idempotent cancellation checks around
  `:3590-3620` and `:4100-4140`; use for M04 differentiation after M03
  validation is in place.

Forwarding and client tests to include in the M03 focused run:

- `packages/auth/test/native-gateway-services.test.ts` (native browser-facing
  adapter and error mapping; see current setup at `:45-125`).
- `packages/auth/test/native-relay.test.ts` (typed application metadata/error
  propagation while dropping backend protocol headers; current cases
  `:158-238`).
- `packages/auth/test/unary-gateway.test.ts` (authenticated gateway forwarding).
- `packages/server/test/server/node-coordinator.test.ts` (Coordinator native
  forwarding and metadata; Query forwarding implementation is visible at
  `packages/server/src/server/node-coordinator.ts:885-910`).
- `packages/client-web/test/client.test.ts` (Query API and typed NotFound detail
  conventions at `:1680-1740`; add Query transport rejection coverage).

Suggested focused command after generated output is prepared and M02 releases the
worktree:

```sh
pnpm exec vitest run packages/server/test/services/spine-services.test.ts packages/auth/test/native-gateway-services.test.ts packages/auth/test/native-relay.test.ts packages/auth/test/unary-gateway.test.ts packages/server/test/server/node-coordinator.test.ts packages/client-web/test/client.test.ts --maxWorkers=1
```

## Fixture/provenance notes

`Query` declares required `id`, `target`, and validated `context` in
`packages/proto/proto/spine/client/query.proto:100-114`. `Topic` declares
required `id`, `target`, and validated `context` at
`packages/proto/proto/spine/client/subscription.proto:62-75`. The nested
`ActorContext.actor` and `.timestamp` are both required at
`packages/proto/proto/spine/core/actor_context.proto:45-58`.

The common server fixture `createActorContext` at
`packages/server/test/services/spine-services.test.ts:5104-5113` sets actor but
omits the required timestamp, so most Query/Topic helpers inherit the omission.
The same fixture file constructs Topic messages without `context` or `id` in
intentional malformed-input tests (for example `:3081-3091`, `:3316-3320`,
`:4324-4325`, `:4374-4378`); keep those as deliberately malformed direct
requests and assert the new structured error. Coordinator tests have many
`create(TopicSchema)` control-flow fixtures with no ID/target/context (e.g.
`packages/server/test/server/node-coordinator.test.ts:131,164,196,219,248`);
separate true admission tests from queue/drain tests, supplying complete
messages where they pass through service validation.

`Query.format` is optional (`query.proto:113`), so absence is valid. When a
ResponseFormat contains OrderBy entries, both `column` and `direction` are
required (`query.proto:58-66`); intentionally malformed ordering cases at
`spine-services.test.ts:1338-1354` omit a required member or set the reserved
unknown enum. Preserve their intent while moving the result to the RPC error
channel. Nested `TargetFilters` has a legacy required-field either/or at
`packages/proto/proto/spine/client/filters.proto:73-81`; empty-filter cases are
intentionally malformed and should remain useful validation regressions.

Do not directly edit `filters.proto` or `query_service.proto` as ordinary
upstream copies. `spine-sources.json:51-57` pins `filters.proto` to
`SpineEventEngine/core-java@a408b0d70dafd603efc55b89c8b4b6f3e8c19d3b` and its
source digest. The migration guardrail is already recorded in
`WORK_LOG.md:140-150`, `M01.md:108-113`, and `MILESTONES.md:499-518`: record the
original upstream provenance/digest, local digest, and exact narrow delta; keep
source verification and descriptor compatibility fail-closed. `scripts/verify-proto-sources.mjs:224-292`
validates the manifest and bytes; `packages/proto/scripts/verify-descriptor-compatibility.mjs:49-128`
compares the frozen-source descriptor set with
`packages/proto/proto/frozen-descriptor-set.sha256`. `scripts/proto-workflow.mjs:191-229`
runs source verification and descriptor comparison during generation.

No verification commands were run and no production/test/Proto files were edited
for this read-only source scan. Only this baseline map is new.
