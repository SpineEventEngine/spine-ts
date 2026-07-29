# Chat example family

This directory groups the complete Projection-backed Chat example. It is a
four-package workspace family, not one published package:

- `app/` (`@spine-event-engine/example-chat-app`) is the in-memory server and
  application handlers.
- `model/` (`@spine-event-engine/example-chat-model`) owns Chat Proto messages,
  commands, events, and rejections.
- `users-model/` (`@spine-event-engine/example-chat-users-model`) independently
  owns the User identifier model used by Chat.
- `web/` (`@spine-event-engine/example-chat-web`) is the React browser fixture.

The app directly depends on `users-model` and `model`; `model` also depends on
`users-model`, and `web` depends on both model packages. Registry composition
may reach Users transitively through Chat's model module. The browser calls the
application through public client APIs and does not import application handlers.

## Generate, build, and test

From the repository root, regenerate all model output, the app registry, and
handler metadata before a build or focused test:

```sh
pnpm proto:generate
pnpm typecheck:build:generated
pnpm exec vitest run examples/chat/app/test examples/chat/web/test/chat-web.test.tsx
```

`model/` and `users-model/` own generated Proto output. `app/` owns its
composed model registry and generated handler registry. Generated directories
are ignored and must be produced by the commands above, never edited by hand.
For local package commands, use `pnpm --dir examples/chat/app proto:compose`,
`pnpm --dir examples/chat/app handlers:generate`, or
`pnpm --dir examples/chat/web test:browser` as appropriate.

## Server, browser, and authentication topology

The app starts an in-memory, loopback Chat server. The browser fixture talks to
an authentication gateway through Envoy; the browser never connects to the
backend directly. The hosting application establishes its session, while the
gateway resolves trusted actor, tenant, room permissions, and subscription
ownership. See the app and web READMEs plus the
[browser client, authentication, and gateway extension guide](../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md)
for integration details.

`PostMessage` creates a message aggregate and a `ChatMessageView` Projection.
The browser posts commands, queries room-filtered views, and subscribes to the
same Projection topic. Duplicate message IDs record the domain rejection event
without changing the admitted command transport acknowledgement.

Subscriptions are best-effort notifications, not a complete event stream.
Notifications may be duplicated, omitted, or reordered; clients reconnect and
re-query the authoritative Projection state when a gap is possible.
