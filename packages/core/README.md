# @spine-ts/core

Core runtime metadata APIs for Spine TS.

The package currently provides the first descriptor-backed type registry slice:

- deterministic type URL derivation from a schema file's Spine
  `type_url_prefix` option;
- fallback type URL derivation using `type.googleapis.com` for files without a
  Spine prefix option;
- schema registration and lookup by full Protobuf type name, type URL, and
  schema identity;
- fail-fast duplicate detection for full names, type URLs, and descriptor
  identity conflicts;
- descriptor metadata for the registered schema, declaring file, first field,
  and file option access; and
- a default `spineCoreRegistry` containing the current curated Spine schemas
  exported by `@spine-ts/proto`.

```ts
import { FieldPathSchema } from "@spine-ts/proto";
import { deriveTypeUrl, spineCoreRegistry } from "@spine-ts/core";

const typeUrl = deriveTypeUrl(FieldPathSchema);
const metadata = spineCoreRegistry.getByTypeUrl(typeUrl);

console.log(metadata.fullTypeName);
```

Semantic tag lookup is intentionally empty for the current copied proto closure
because no registered schema currently proves `(is)` or `(every_is)` consumer
metadata. The lookup API is present so later validation/routing tasks can add
descriptor-backed tags without changing callers.

This package does not yet implement validation, `Any` packing/unpacking,
runtime buses, entity repositories, storage, decorators, handlers, or transport
behavior.
