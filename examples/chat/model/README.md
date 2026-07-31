# Chat model

Prerequisites: Node 24 LTS or newer and pnpm. Install once with
`pnpm install --frozen-lockfile` from the repository root.

This private workspace package owns the Chat Proto messages, commands, events,
rejections, and generated TypeScript used by the Chat app and browser UI. It
has no server, UI, listener, or shutdown lifecycle of its own.

After `pnpm install --frozen-lockfile` at the repository root, the supported
Chat app and web commands own generation and build preparation:

```sh
pnpm --dir examples/chat/app start
pnpm --dir examples/chat/web start
```

Generated output is ignored and must not be edited. The model is local and
in-memory examples use it only for development; it is not a published package
or a production deployment contract.
