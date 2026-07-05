# @spine-ts/testing

In-process black-box testing utilities for built Spine TS bounded contexts.

## Bounded Context Fixture

`BoundedContextFixture` wraps one built `@spine-ts/server` `BoundedContext` and
drives it through the same framework seams used by the raw Spine services:

- `post(command)` calls the in-process `CommandService.Post` adapter and
  returns the real `Ack`.
- `postEvent(event)` posts through the built context event endpoint.
- `read(query)` calls the in-process `QueryService.Read` adapter and returns
  the real `QueryResponse`.
- `readEventually(query, accept?)` polls `QueryService.Read` for asynchronous
  projection consequences without making command posting synchronous.
- `subscribe(topic)` calls `SubscriptionService.Subscribe`, activates the
  subscription, and returns a small handle with `next()`, `cancel()`, and
  `close()`.

All command, event, query, acknowledgement, response, subscription, and update
messages are cloned at the fixture boundary. Tests should construct generated
protobuf messages directly with `@bufbuild/protobuf` and `@spine-ts/core`
packing helpers.

```ts
import { BoundedContextFixture } from "@spine-ts/testing";

const context = BoundedContext.singleTenant("Tasks")
  .add(taskAggregateRepository)
  .add(taskProjectionRepository)
  .build();
const fixture = new BoundedContextFixture(context);

const updates = await fixture.subscribe(taskTopic);
await fixture.post(createTaskCommand);

const update = await updates.next();
const response = await fixture.readEventually(taskQuery);

await updates.close();
```

The fixture is intentionally narrow. It does not start processes, browsers, or
local servers; it is not a client DSL; and it does not simulate command, query,
or subscription behavior outside the built context and `SpineServices` seams.
