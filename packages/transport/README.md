# @spine-event-engine/transport

`@spine-event-engine/transport` defines a small transport contract for routing
Spine signals and includes a same-host ZeroMQ adapter. Use it when an
application or framework integration needs publish, request, response, or
subscription operations outside an in-process call.

For the full routing and shutdown contract, see
[REFERENCE documentation for agents](REFERENCE.md).

## Use from this source workspace

```sh
pnpm --filter @spine-event-engine/transport build
```

This private snapshot package is not published to an npm registry. Use it from
this workspace while developing the framework.

The ZeroMQ adapter also needs its native `zeromq` dependency, which this package
declares.

## Publish a local signal

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
