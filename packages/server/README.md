# @spine-ts/server

Descriptor-derived server metadata for Spine entity schemas.

Current slice exposes:

- `describeEntityMetadata(schema)` for deterministic entity kind/visibility metadata;
- `isEntitySchema(schema)` for pure descriptor checks;
- first-field routing hints from descriptor order;
- `(column)` and `(set_once)` field discovery; and
- semantic tags from `(is)` and `(every_is)` with clear extraction errors.

This package still does not implement handler registration, transactions,
repositories, storage, buses, transport, or gRPC services.
