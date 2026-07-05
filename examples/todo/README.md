# To-Do Example

Standalone server-side to-do example placeholder. The workspace exists so later
framework slices have a stable place to add generated domain messages, server
assembly, command handling, query/subscription behavior, and black-box tests.

Current status: Protobuf contracts and generation workflow exist; not runnable.

The example domain Protobuf files and generated schema workflow were added in
T-0012.12a. Server startup, command handling, queries, subscriptions,
validation behavior, and black-box tests are still deferred until the framework
runtime exists. T-0011 adds useful seams for that future work:
adapter-agnostic transport topics/subscriptions, broker/worker lifecycle
contracts, delivery/retry boundary data, and
`createServerRuntimeRoutingPlan()` for deriving command/event routing metadata
from bounded-context handler readiness.

Those seams are not an executable to-do application. There is still no to-do
server process, ZeroMQ endpoint layout, service host, handler dispatch,
repository runtime registration, durable delivery worker, query stand,
subscription stream, or production storage adapter in this example.
