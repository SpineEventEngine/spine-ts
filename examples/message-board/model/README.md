# MessageBoard Protobuf model

This package contains the vocabulary shared by the MessageBoard server and
browser: user, board, and message IDs; commands that request posting; events
that record postings; visible query-side state; and domain rejections.

## 💡 Why is the model separate?

- ✅ Server and browser compile against the same message schemas.
- ✅ Validation rules live beside fields in Proto.
- ✅ Generated TypeScript and rejection helpers are deterministic.
- ✅ The package can be replaced by a published application model later.

## 🚀 Generate the model

Workspace development generates the model before local startup. Production
images contain prebuilt compiled artifacts and never generate the model. To run
workspace generation directly:

```bash
pnpm proto:generate
```

Authored `.proto` files are source. Files under `generated/` are outputs and
must not be edited.

The `PostMessage` command is also the source of truth for required username and
message validation. Generated code carries those rules to the server; the web
application reads the resulting structured error response.

## 📦 Used by

- [`app`](../app/README.md) imports schemas and generated handler types.
- [`web`](../web/README.md) imports the same commands and Projection schemas.

The package has no server, UI, storage, or process lifecycle.

## 🔗 Learn more

- [Complete MessageBoard example](../README.md)
- [Protobuf tooling](../../../packages/proto-tools/README.md)
- [Reference for coding agents](REFERENCE.md)
