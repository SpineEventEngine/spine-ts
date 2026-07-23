# T-0067 Wave 1 Security Findings

Status: clean with one explicitly accepted trusted-network residual.

## Review Inputs

- Existing canonical threat model plus its T-0067 Wave 1 extension.
- Public Node client, Projection query, singleton environment, BlackBox,
  Delivery/DeliverySupervisor, delivery client, standalone in-memory delivery
  server, Admin/health, and multi-process topology.
- Frozen upstream decisions and explicit Node-only, trusted-network, in-memory,
  and Wave 2/3/4 exclusions.
- Production and full dependency audits after T-0067b integration.

## Hypothesis Dispositions

| Hypothesis | Disposition                                     | Reason                                                                                                                                                                                                                                                              |
| ---------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TM-013     | Accepted residual                               | Worker-agnostic release matches the frozen simple-server and is acceptable only inside the documented trusted private network.                                                                                                                                      |
| TM-014     | Clean                                           | Retained messages (10,000), serialized bytes (32 MiB), and tracked shards (1,000) have safe finite defaults and atomic admission; full records and exact requested responses are byte-bounded, released shards are pruned, and snapshot/expiration work is bounded. |
| TM-015     | Clean                                           | Server admission requires every persisted record to satisfy the same complete Command/Event, enum, timestamp, and payload-size boundary required by the client decoder.                                                                                            |
| TM-016     | Clean                                           | Single-attempt mutations, surfaced uncertainty, and durable removal quarantine/reconciliation preserve the declared at-least-once contract.                                                                                                                         |
| TM-017     | Clean                                           | Canonical imports, resolve-once configuration, and terminal lifecycle protect the supported singleton module graph.                                                                                                                                                 |
| TM-018     | Clean                                           | `BlackBox` is exported only by the testing package and documented as test-only.                                                                                                                                                                                     |

## P1 Findings

### Finite retained state and response work

A peer that can reach the unauthenticated listener can grow retained message
and shard maps without a total bound. Batch admission has no server-side cap;
reads sort retained state; Admin snapshots enumerate every shard; and expired
session release returns every released shard. The 4 MiB inbound RPC limit, 100
pending mutations, 1,000-entry page cap, and bounded Admin subscriber queues
do not bound retained memory/CPU or generated response size.

Correction: add finite safe defaults (or bounded configuration) for retained
messages/bytes and tracked shards, reject admission at capacity, validate
server-side batches/payload sizes, and bound snapshot/expiration response work
to the RPC ceiling. Add adversarial capacity tests and correct public claims.

### Canonical inbox admission

Server admission validates only shard, UUID, and timestamp. It does not require
the supported Command/Event payload kind and byte limit or validate every
field/enum required by the delivery-client decoder. A direct peer can persist
a poison record that makes later page reads fail before legitimate dispatch.

Correction: apply canonical validation to every single and batch inbox record
before admission and add direct-RPC rejection regressions.

## Correction evidence

- `InMemoryDeliveryState` owns atomic retained-message, serialized-byte, and
  tracked-shard admission; `DeliveryServer` exposes validated construction and
  environment configuration for each finite budget.
- Inbox single/batch mutations validate complete client-decodable records,
  supported Command/Event payloads, enum values, timestamps, and the 1 MiB
  payload limit before queued mutation admission. Mixed invalid batches leave
  state unchanged.
- Focused direct-service regressions cover poison payloads, invalid enums,
  oversized payloads, atomic capacity rejection, and shard-session capacity.
- Admin snapshots and one expiration response have a 1,000-observation cap;
  tracked-shard configuration may not exceed that cap, keeping response work
  below the documented 4 MiB RPC ceiling. Stored worker/node IDs together are
  capped at 128 UTF-8 bytes, so expiration records cannot defeat that bound.
- Full records must fit below the 4 MiB RPC ceiling. `findOne`, newest, and
  requested page responses are encoded and checked; an over-ceiling page fails
  explicitly with `RESOURCE_EXHAUSTED` and is never silently shortened.
- Released message-free shards, including records whose final retained message
  is removed later, are pruned. Both write and remove batches are rejected
  outside 1..100 before record validation or copying.
- Safe delivery-client reads preserve the server's `RESOURCE_EXHAUSTED` status
  without retry so callers can reduce an oversized page request; other
  nonretryable server statuses remain sanitized as `DeliveryProtocolError`.
  The focused lifecycle regression passed 1 file / 26 tests.

Reviewer profile: existing final `security_reviewer`, explicitly dispatched as
`gpt-5.6-terra` / `high`. Runtime self-introspection was unavailable; no
mismatch or fallback was visible.

Final targeted security recheck: clean. Unrestricted focused verification
passed 2 files / 15 tests. TM-014 and TM-015 are closed; TM-013 remains the
human-approved frozen simple-server behavior constrained to the documented
trusted private network.
