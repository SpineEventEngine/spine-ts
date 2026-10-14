# Post-Cancel Event publication control

The targeted reliability rereview found that the prior Project 4 absence
assertion ran after its Command handler entry, before an observable Event
publication boundary. That could pass while Project 4 was still in flight.

The corrected `cancel-publication-race` fixture completes Cancel for the
original Event subscription, activates a separate generated ProjectCreated
Event observer, then posts Project 4. It requires the observer's real
`eventUpdates` item to contain exactly one ProjectCreated with Project number
4. The server-side trace must then contain exactly one Project 4 yield with
the same Event ID, attributed to the observer subscription ID, and zero yields
attributed to the canceled subscription ID. The observer and Entity
subscription both complete their Cancel RPCs. This is a live publication
control after removal, not an Ack or elapsed-time inference.

Focused PostgreSQL 16 controls passed for database-only/native and
shared-memory/native, gRPC-Web, and Connect: four selected Vitest invocations,
one test each, all exit 0. Each opt-in wrapper checks its UUID database drop
and HTTP/2 session cleanup. Touched ESLint, Prettier, server-blackbox-tests
TypeScript no-emit, and `git diff --check` all exited 0. The 24 cancellation-race
provider/transport/mode rows and targeted rereview remain pending.
