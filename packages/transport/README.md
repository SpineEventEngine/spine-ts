# Local transport for Spine TS

`@spine-event-engine/transport` gives a Spine application typed, process-local
message channels. It is for application and infrastructure developers who need
to connect the external-message broker in a local or test process; it is not a
general internet messaging client.

This is an experimental snapshot package. Use Node 24 or newer and generated
Spine Protobuf contracts before integrating it. Start with the package
[reference](REFERENCE.md) for the complete lifecycle and channel contract.

## Install

```sh
pnpm add @spine-event-engine/transport@snapshot
```

The `snapshot` tag is intentionally experimental and can change before a
stable release.

## First success: create a local channel

Create an `InMemoryTransportFactory`, then let the broker-facing application
code request its typed `MessageChannel`. The channel carries generated
`ExternalMessage` values and canonical target type URLs; it does not serialize
them for another process.

<!-- docs-snippet-path: packages/transport/test/memory/message-transport.test.ts -->

```ts
import { create, toBinary } from "@bufbuild/protobuf";
import { AnySchema, StringValueSchema } from "@bufbuild/protobuf/wkt";
import {
  BoundedContextNameSchema,
  ChannelIdSchema,
  ExternalMessageSchema,
} from "@spine-event-engine/proto";
import { InMemoryTransportFactory } from "@spine-event-engine/transport";

const factory = new InMemoryTransportFactory();
const channel = create(ChannelIdSchema, { targetType: "type.spine.io/acme.tasks.Task" });
const subscriber = await factory.createSubscriber(channel);
const received: string[] = [];
const consumer = await subscriber.addConsumer((message) => {
  received.push(message.id?.typeUrl ?? "");
});
const publisher = await factory.createPublisher(channel);
const id = create(AnySchema, {
  typeUrl: "type.spine.io/google.protobuf.StringValue",
  value: toBinary(StringValueSchema, create(StringValueSchema, { value: "task-42" })),
});

try {
  await publisher.publish(
    id,
    create(ExternalMessageSchema, {
      id,
      originalMessage: id,
      boundedContextName: create(BoundedContextNameSchema, { value: "tasks" }),
    }),
  );
  if (received[0] !== id.typeUrl) throw new Error("The consumer did not receive the frame.");
} finally {
  await consumer.close();
  await subscriber.close();
  await publisher.close();
  await factory.close();
}
```

## What it does not provide

This package has no network listener, persistence, cross-process delivery,
authentication, or broker retry policy. Use it for local composition and tests;
choose a deployment-specific transport for communication across processes.

## Next steps

- Read the [transport reference for coding agents](REFERENCE.md) for publisher,
  subscriber, and `ConsumerHandle` lifecycle rules.
- See [Protobuf contracts](../proto/README.md) for generated message types.
