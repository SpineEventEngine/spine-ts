# Distributed Message Board reference

This package is a deployment wrapper, not another Message Board implementation.
It reuses `examples/message-board/model`, `examples/message-board/app`, and
`examples/message-board/web`; no Proto, Aggregate, Projection, or React source
belongs here.

`deploy/compose.yaml` starts two identical application processes against one
shared application-selected Datastore emulator. Both use the same in-memory
simple delivery server. A single standalone Gateway has a fixed backend list of
both application URLs and owns the browser-facing subscription bindings.

Commands may be accepted by either application node. Delivery chooses one
owner for aggregate work; the corresponding event drives one Projection result
in shared storage. Browser notices are best effort only. The UI uses the
Gateway to query the Projection authoritatively after any notice or reconnect.

Use `pnpm start` in this directory after building local images. It keeps the
Compose processes attached so `Ctrl-C` requests their finite shutdown. For a
non-interactive stop, run `docker compose --file deploy/compose.yaml down`.

The in-memory simple delivery server has no durable or highly available mode.
This example intentionally adds neither discovery/redeployment behavior nor a
new authentication boundary.
