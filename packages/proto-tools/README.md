# @spine-event-engine/proto-tools

`@spine-event-engine/proto-tools` is build-time tooling for application-owned
Proto model packages and applications that compose them. It is not a server
runtime dependency. Its `spine-proto` binary has three commands:

```bash
spine-proto generate # model package only
spine-proto compose  # application package only
spine-proto handlers # application package only
```

## Model packages: `generate`

A model package owns canonical `.proto` files and exports one `ProtoModule`.
Use separate packages for independently developed bounded contexts, or one
combined model package for a small application. This configuration is complete:

```json
{
  "formatVersion": 1,
  "mode": "model",
  "packageName": "@acme/users-model",
  "protoRoot": "proto",
  "generatedRoot": "generated",
  "exportRoot": "generated",
  "dependencies": ["@spine-event-engine/proto"],
  "moduleExport": "usersProtoModule"
}
```

`generate` writes ignored Protobuf-ES sources below `generatedRoot`, a root
`proto-module.ts`, and `spine-proto-manifest.json`. The manifest is
deterministic: it records the format version, package name/version, sorted
canonical Proto files, each generated export, direct model dependencies, and
the module export. Generation stages output and manifest before replacement, so
failed validation or Buf generation preserves the previous output.

The package must ship `dist`, `proto`, `spine-proto.json`, and
`spine-proto-manifest.json`, and expose these subpaths:

```json
{
  "exports": {
    ".": {
      "types": "./dist/generated/proto-module.d.ts",
      "default": "./dist/generated/proto-module.js"
    },
    "./spine-proto-manifest.json": "./spine-proto-manifest.json",
    "./proto/*": "./proto/*",
    "./generated/*.js": {
      "types": "./dist/generated/*.d.ts",
      "default": "./dist/generated/*.js"
    }
  }
}
```

For a cross-model import, declare the other package in both `package.json` and
`dependencies` in `spine-proto.json`, then import its canonical path:

```proto
import "acme/users/v1/users.proto";

message Task {
  acme.users.v1.UserId author = 1;
}
```

The dependent model's generated TypeScript imports
`@acme/users-model/generated/...`; it does not duplicate Users source or
generated output. Generation rejects undeclared or unowned imports, missing
manifest/proto exports, graph cycles, unsafe paths or symlink ancestors, and
duplicate fully qualified generated messages.

## Application packages: `compose` and `handlers`

An application declares direct model roots and a safe source-file destination:

```json
{
  "formatVersion": 1,
  "mode": "application",
  "modelPackages": ["@acme/chat-model"],
  "registryOutput": "src/model-registry.ts"
}
```

`compose` resolves manifests transitively, verifies every dependency, and writes
the configured registry source. The direct imported module is sufficient:
`TypeRegistry.from()` follows each module's declared dependencies. Run it after
model-package changes.

`handlers` discovers decorated application handlers and atomically writes
`generated/handler/generated-handler-registry.ts`. Run it after changing a
handler class or its generated command/event/state types, then compile it into
`dist/generated/handler/` with the rest of the application.

```bash
spine-proto compose
spine-proto handlers
tsc -b
```

Run these commands in a clean checkout and CI. Do not author generated files by
hand or use repository-relative aliases in a package intended for publication.
Spine TS packages are not published to npm yet; the local-tarball acceptance
test simulates a clean registry consumer, and publication is revisited after
all waves.
