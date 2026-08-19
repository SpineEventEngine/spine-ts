# Distributed Message Board reference

This package is a deployment wrapper, not another Message Board implementation.
It reuses `examples/message-board/model`, `examples/message-board/app`, and
`examples/message-board/web`; no Proto, Aggregate, Projection, or React source
belongs here.

`deploy/compose.yaml` starts two identical application processes against one
shared application-selected Datastore emulator. Both use the same in-memory
simple delivery server. A single standalone Gateway has a fixed backend list of
both application URLs only as this local Compose fixture and provides the
browser-facing subscription bindings. Production GKE/GCE deployment instead
uses dynamic discovery; this example intentionally does not.

Commands may be accepted by either application node. Delivery chooses one
owner for aggregate work; the corresponding event drives one Projection result
in shared storage. The Gateway stores the logical subscription definition, not
a replay log of delivered browser updates. The UI applies a valid, complete
subscription payload locally. After a gap, unusable payload, or disconnected
post, it queries the Projection and replaces its local copy; reconnect
resynchronization can also carry that authoritative state directly.

Use `pnpm start` in this directory after building local images. It keeps the
Compose processes attached so `Ctrl-C` requests their finite shutdown. For a
non-interactive stop, run `docker compose --file deploy/compose.yaml down`.

The in-memory simple delivery server has no durable or highly available mode.
This example intentionally adds neither discovery/redeployment behavior nor a
new authentication boundary. It supports one fixed Gateway only; Multiple-
Gateway behavior and Cloud Run are outside this example.
