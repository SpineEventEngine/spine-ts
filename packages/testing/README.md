# @spine-event-engine/testing

Use this package to test a bounded context through the same local server and
Node client boundary used by an application. `BlackBox` is the end-user test
API; it is not a fixture API.

For detailed contracts intended for coding agents, see the
[REFERENCE.md documentation for agents](REFERENCE.md).

## Start a test

Create a `BlackBox` from a built context or its builder. It starts an ephemeral
local server and closes it when the test is finished.

```ts
// docs-snippet-path: packages/testing/src/black-box/black-box.ts
import { BlackBox } from "@spine-event-engine/testing";
import { BoundedContext } from "@spine-event-engine/server";

const box = await BlackBox.from(BoundedContext.singleTenant("Tasks"));
const guest = box.asGuest();
await box.close();
void guest;
```

Create a named scope when a test needs to act as a particular user. Scopes send
queries, post commands, and create subscriptions through the public client API.

```ts
// docs-snippet-path: packages/testing/src/black-box/black-box.ts
import type { BlackBox } from "@spine-event-engine/testing";

declare const box: BlackBox;
const alice = box.onBehalfOf("alice");
// await alice.post(command);
// const result = await alice.send(query);
```

## Observe an asynchronous result

Use `eventually()` only for a result that becomes visible later. Assert an
immediate command result directly instead of polling for it.

```ts
// docs-snippet-path: packages/testing/src/black-box/black-box.ts
import type { BlackBox } from "@spine-event-engine/testing";

declare const box: BlackBox;
const value = await box.eventually(
  async () => "ready",
  (result: string) => result === "ready",
  { timeoutMs: 500, intervalMs: 5 },
);
```

`BlackBox.from()` accepts fixed `tenant`, `zoneId`, `timeoutMs`, and
`intervalMs` options. Time values must be positive integers. `close()` cancels
subscriptions owned by the box, closes its client, and then closes the local
server.

This package tests one local Node process. It does not test a browser,
cross-process delivery, authentication, or a production storage deployment.
