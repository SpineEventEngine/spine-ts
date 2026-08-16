# Transport contracts for Spine signals

`@spine-event-engine/transport` defines a small transport contract for routing
Spine signals and includes a same-host ZeroMQ adapter. Use it when an
application or framework integration needs publish, request, response, or
subscription operations outside an in-process call.

For the full routing and shutdown contract, see
[REFERENCE documentation for agents](REFERENCE.md).

## 💡 Why use it?

- ✅ Gives signal publishers and subscribers one transport-neutral contract.
- ✅ Creates deterministic routing topics from signal and message types.
- ✅ Includes a ZeroMQ IPC adapter for separate processes on one machine.
- ✅ Makes subscription lifecycle and shutdown explicit.

## 🚀 Build it in this workspace

```sh
pnpm typecheck:build
```

Run this workspace-wide TypeScript build from the repository root. This private
snapshot package is not published to an npm registry; use it from this
workspace while developing the framework.

The ZeroMQ adapter also needs its native `zeromq` dependency, which this package
declares.

## 📬 Publish a local signal

Build a topic from a signal kind and a message type URL. A topic's routing key
is calculated deterministically.

```ts
import { TransportSubscriptions, TransportTopics } from "@spine-event-engine/transport";
import { ZeroMqConfig, createZeroMqTransport } from "@spine-event-engine/transport/zeromq";

const transport = createZeroMqTransport(ZeroMqConfig.create({ ipcDirectory: "/tmp/spine-ipc" }));
const topic = TransportTopics.create({
  signalKind: "system",
  messageTypeUrl: "type.example.test/system.Ping",
});
const subscription = TransportSubscriptions.create({
  subscriberId: "logger",
  topic,
});
const handle = await transport.subscribe(subscription, async (operation) => {
  console.log(operation.envelope);
});

await transport.publish({ topic, envelope: { text: "ping" } });
await handle.close();
await transport.close();
```

The ZeroMQ adapter uses local IPC endpoints. It is not a network transport and
does not coordinate machines.

## ⚠️ Choose topology separately

The package does not provide internet routing, authentication, encryption, or
multi-machine discovery. Its ZeroMQ adapter is only for same-host IPC. Use the
application server and Delivery packages for their respective network-facing
responsibilities.

## 🔗 Learn more

- [Server](../server/README.md)
- [Delivery server](../delivery-server/README.md)
- [Reference for coding agents](REFERENCE.md)

## Integration channels

The package also supplies the typed TransportFactory channel seam for external-event integration. InMemoryTransportFactory is the local/test implementation; it is separate from SignalTransport and carries generated ExternalMessage frames only.
