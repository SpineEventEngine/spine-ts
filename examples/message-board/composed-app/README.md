# Composed Message Board

This maintained example assembles one Message Board application from four workspace packages:

| Package                                                | Contribution                                                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| [`model`](../model/README.md)                          | Domain Proto, generated schemas and grouped `ReadBoardStats.Query` / `.Response` aliases.                |
| [`command-handlers`](../command-handlers/src/index.ts) | `BoardMessageAggregate`, which accepts `PostMessage` and emits `MessagePosted`.                          |
| [`view-handlers`](../view-handlers/src/index.ts)       | Message and announcement Projections that consume that Event.                                            |
| `composed-app`                                         | Builds both Bounded Contexts, registers one App Query handler with `Server`, and installs read policies. |

[`new ComposedBoardApplication().create(environment)`](src/index.ts) adds the Aggregate and message Projection from
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

Supply an explicitly configured ServerEnvironment. The returned composition
includes its Application, the two Bounded Contexts, and the Server configured for
that Application. Direct callers close the running endpoint before closing
`composition.application`. The maintained hosts perform that cleanup themselves.

[`ReadBoardStatsHandler`](src/board-query-handler.ts) takes a generated
`ReadBoardStats.Query`, reads cumulative statistics from the two Bounded
Contexts through `context.select()`, and returns its paired generated
`ReadBoardStats.Response`. A trusted in-process caller uses
`server.query(query, executionContext)`; the Node client uses
`client.asGuest().query(query)` and infers the response type from the generated
companion. Individual messages use ordinary Entity queries. The model can be
imported by a browser client without importing these Server handlers. The
installed browser and Node declaration proof is in
[`external-consumer.test.ts`](../../../packages/proto-tools/test/external-consumer.test.ts).
The generated TypeScript `board` field remains optional because Proto
required-field rules run at Server admission; the handler asserts its presence
after that boundary. The test confirms a missing `board` never invokes the
handler.

`AggregateVisibility`, `BoardVisibility`, and `BoardStatisticsVisibility` filter
direct Aggregate state, Message Board rows, and lifetime statistics in the
Message Board Bounded Context. `AnnouncementVisibility` filters the separate
announcement Bounded Context. The Server egress policy redacts author display
names in direct Aggregate state and nested message views for public readers,
and prevents contributor arrays from leaving in any mode. Restricted state,
rows, statistics, and Events require verified `canReadRestricted` authority
facts; an actor name alone never supplies those facts. `ReadBoardStats` combines
the two cumulative views and returns counts by domain `UserId`, plus the first
accepted Event timestamp. These counts describe author IDs, not verified people.

The runnable app configures either public admission or `SignedSessions` with a protected P-256 signing key. Its Gateway verifies bearer credentials and forwards operation-bound HMAC proof to the native reader path. Native direct Query and subscription admission verifies credentials; the native endpoint must remain on the trusted internal network. The offline `issue-board-session` command issues administrator-approved credentials.
The [executable test](test/composed-app.test.ts) exercises internal and native
RPC App Query calls, individual Entity queries, public removal versus trusted
access, and actual Entity and Event RPC subscriptions. A statistics query may
return a successful paired response without a board summary when no visible
statistics exist; malformed requests fail
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
