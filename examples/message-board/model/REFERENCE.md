# Message Board model reference

This reference is for coding agents and maintainers. Beginners should start
with the [Message Board model README](README.md).

The package owns every Message Board Proto type, including `UserId`. Do not create a
second users-model package. Proto packages use `spine.examples.messageboard`, and type
URLs use `type.spine.examples.messageboard`.

Generation produces Protobuf-ES modules, a `ProtoModule`, and typed rejection
companions for `*rejections.proto`. The app and web packages import generated
artifacts through this package’s declared exports. Do not hand-author rejection
factory boilerplate or edit generated output.

Field validation uses Spine validation options and runs in the server before a
signal handler. Proto comments use Message Board vocabulary rather than CQRS framework
terms and keep a blank line between documented fields.

```bash
pnpm proto:generate
pnpm exec tsc -b examples/message-board/model/tsconfig.json
```
