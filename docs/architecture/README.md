# Architecture Notes

Current status: early implementation notes.

Architecture documentation starts from the build protocol and specification documents under `build-protocol/`. This folder is reserved for implementation-era architecture notes that evolve with actual package boundaries and runtime behavior.

## Proto Contract Boundary

The `proto/` tree now contains the first verbatim copied Spine contract closure.
`@spine-ts/proto` compiles and exports those contracts as Protobuf-ES schemas.
This boundary is intentionally contract-only:

- generated schemas are available for later metadata and validation tasks;
- copied source provenance is verified by `proto/spine-sources.json`;
- runtime registries, `Any` packing/unpacking, validation facade behavior,
  buses, storage, and transport remain out of scope until later tasks.
