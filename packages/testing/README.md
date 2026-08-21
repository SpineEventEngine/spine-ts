# Black-box testing for Spine applications

Use this package to test a bounded context through the same local server and
Node client boundary used by an application. `BlackBox` is the end-user test
API; applications do not need internal test utilities.

For detailed contracts intended for coding agents, see the
[REFERENCE.md documentation for agents](REFERENCE.md).

This is an experimental snapshot package. Use Node 24 or newer and an
application Bounded Context before writing BlackBox tests.

```sh
pnpm add -D @spine-event-engine/testing@snapshot
```

## 💡 Why use it?

- ✅ Tests a complete bounded context through real Spine services.
- ✅ Posts commands, reads query-side views, and observes subscriptions as a
  user.
- ✅ Runs on an ephemeral local server with predictable cleanup.
- ✅ Waits for genuinely asynchronous results with bounded polling.

## 🚀 Start a test

Create a `BlackBox` from a built context or its builder. It starts an ephemeral
local server and closes it when the test is finished.

<!-- docs-snippet-path: packages/testing/src/black-box/black-box.ts -->

```ts
import { BlackBox } from "@spine-event-engine/testing";
import { BoundedContext } from "@spine-event-engine/server";

const box = await BlackBox.from(BoundedContext.singleTenant("Tasks"));
const guest = box.asGuest();
await box.close();
void guest;
```

Create a named scope when a test needs to act as a particular user. Scopes send
queries, post commands, and create subscriptions through the public client API.

<!-- docs-snippet-path: packages/testing/src/black-box/black-box.ts -->

```ts
import type { BlackBox } from "@spine-event-engine/testing";

declare const box: BlackBox;
const alice = box.onBehalfOf("alice");
const result = await box.eventually(
  async () => ({ actor: alice }),
  (response) => response.actor === alice,
);
void result;
```

## ⏳ Observe an asynchronous result

Use `eventually()` only for a result that becomes visible later. Assert an
immediate command result directly instead of polling for it.

<!-- docs-snippet-path: packages/testing/src/black-box/black-box.ts -->

```ts
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
subscriptions created by the box, closes its client, and then closes the local
server.

## ⚠️ Test boundary

`BlackBox` tests one local Node process. It does not prove browser behavior,
cross-process delivery, authentication infrastructure, or a production storage
deployment. Choose the application’s real storage factory only when an
integration test intentionally covers that provider.

## 🔗 Learn more

- [Todo example tests](../../examples/todo/README.md)
- [Server](../server/README.md)
- [Reference for coding agents](REFERENCE.md)
