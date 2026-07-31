# Chat Protobuf model

This package contains the vocabulary shared by the Chat server and browser:
user, room, and message IDs; commands; events; visible message state; and
domain rejections.

## 💡 Why is the model separate?

- ✅ Server and browser compile against the same message schemas.
- ✅ Validation rules live beside fields in Proto.
- ✅ Generated TypeScript and rejection helpers are deterministic.
- ✅ The package can be replaced by a published application model later.

## 🚀 Generate the model

The normal Chat startup commands generate the model automatically. To run the
workspace generation directly:

```bash
pnpm proto:generate
```

Authored `.proto` files are source. Files under `generated/` are outputs and
must not be edited.

## 📦 Used by

- [`app`](../app/README.md) imports schemas and generated handler types.
- [`web`](../web/README.md) imports the same commands and Projection schemas.

The package has no server, UI, storage, or process lifecycle.

## 🔗 Learn more

- [Complete Chat example](../README.md)
- [Protobuf tooling](../../../packages/proto-tools/README.md)
- [Reference for coding agents](REFERENCE.md)
