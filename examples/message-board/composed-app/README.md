# Composed Message Board

This maintained example assembles one Message Board application from four workspace packages:

| Package                                                | Contribution                                                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| [`model`](../model/README.md)                          | Domain Proto, generated schemas and grouped `ReadBoardMessage.Query` / `.Response` aliases.              |
| [`command-handlers`](../command-handlers/src/index.ts) | `BoardMessageAggregate`, which accepts `PostMessage` and emits `MessagePosted`.                          |
| [`view-handlers`](../view-handlers/src/index.ts)       | Message and announcement Projections that consume that Event.                                            |
| `composed-app`                                         | Builds both Bounded Contexts, registers one App Query handler with `Server`, and installs read policies. |

[`new ComposedBoardApplication().create()`](src/index.ts) adds the Aggregate and message Projection from
different packages to **one** Bounded Context. It builds the announcements Bounded
Context from the view package. The announcement subscriber declares
`External<MessagePosted>` so the existing integration broker delivers the
message posted by the other Bounded Context. Its single generated bootstrap import registers
the passive metadata exported by the dependency packages' `./spine` entries.
The classes passed to `.add()` and the App Query handler instance passed to
`ServerOptions.appQueries` decide what runs. Normal generation discovers
installed runtime dependencies and writes `generated/spine-metadata.ts`,
`generated/spine-bootstrap.ts`, and the dependency adapters. Regenerate after
installing or changing dependencies; neither Bounded Context needs a registry
root.

[`ReadBoardMessageHandler`](src/board-query-handler.ts) takes a generated
`ReadBoardMessage.Query`, reads `BoardMessageView` through `context.select()`,
and returns its paired generated `ReadBoardMessage.Response`. A trusted
in-process caller uses `server.query(query, executionContext)`; the Node client
uses `client.asGuest().query(query)` and infers the response type from the
ordinary generated companion. The model can be imported by a browser client
without importing these Server handlers. The installed browser and Node
declaration proof is in
[`external-consumer.test.ts`](../../../packages/proto-tools/test/external-consumer.test.ts).
The generated TypeScript field remains optional because Proto required-field
rules are enforced at Server admission; the handler uses a type assertion after
that boundary. The test confirms a missing `message` never invokes the handler.

[`BoardVisibility`](src/read-policies.ts) selects the actual
`BoardMessageViewSchema` at the Bounded Context and Server boundaries, with
`nested: true` for a view inside an App Query result. It removes messages on
the `restricted` board unless verified authority facts grant access, and masks
the display name for a public reader. `ResultLabel` independently selects the
root `ReadBoardMessage.responseSchema` at Server egress. An `ActorContext`
actor name alone is not authentication. `PublishedEventVisibility` separately filters the
`MessagePosted` payload of a subscription update; the Event envelope stays
intact. `ComposedBoardApplication` accepts the Server's native `readerAdmission`
port. The test's static verifier and direct trusted context are fixtures only.
A real application must verify native peer credentials and resolve authority
facts through replaceable application ports; it should not treat
client-supplied actor metadata or headers as proof. The framework copies facts
for each invocation; it does not forward credentials or promise provider
liveness.

The [executable test](test/composed-app.test.ts) exercises internal and native
RPC App Query calls, a direct Entity Query, public removal versus trusted
access, and actual Entity and Event RPC subscriptions. An empty paired result
is one successful decoded App Query response row without a `message` field,
not zero result rows; malformed requests fail
with structured RPC details. Unknown subscription activation yields
`NOT_FOUND` with `UNKNOWN_SUBSCRIPTION`, while cancelling an unknown ID remains
successful and idempotent. The client recovers an expired subscription using
a fresh ID within its configured retry policy; an Event stream cannot replay
the missed gap.

From the repository root, run normal model generation, then dependency and app
handler generation before building the packages:

```bash
pnpm --dir examples/message-board/model proto:generate
pnpm exec tsc -b examples/message-board/model
pnpm --dir examples/message-board/command-handlers handlers:generate
pnpm exec tsc -b examples/message-board/command-handlers
pnpm --dir examples/message-board/view-handlers handlers:generate
pnpm exec tsc -b examples/message-board/view-handlers
pnpm --dir examples/message-board/composed-app handlers:generate
pnpm exec tsc -b examples/message-board/composed-app
pnpm exec vitest run examples/message-board/composed-app/test/composed-app.test.ts
```

The root `pnpm proto:generate` and TypeScript build scripts run the same normal
generation pipeline for the whole workspace. Generated source and compiled
files stay out of Git.
