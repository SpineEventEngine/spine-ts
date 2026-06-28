import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { describe, expect, it } from "vitest";
import { CommandSchema, file_spine_options } from "@spine-ts/proto";

import * as serverRoot from "./index.js";
import { describeEntityMetadata, DescriptorMetadataError, isEntitySchema } from "./index.js";

type ProjectionState = Message<"example.entity.ProjectionState"> & {
  id: string;
  name: string;
  priority: number;
};

type AggregateState = Message<"example.entity.AggregateState"> & {
  id: string;
  name: string;
  archived: boolean;
};

type GenericState = Message<"example.entity.GenericState"> & {
  id: string;
};

type EmptyState = Message<"example.entity.EmptyState">;
type UnknownKindState = Message<"example.entity.UnknownKindState"> & { id: string };
type InvalidColumnState = Message<"example.entity.InvalidColumnState"> & {
  id: string;
  tags: string[];
};
type InvalidTagState = Message<"example.entity.InvalidTagState"> & { id: string };
type ProcessManagerState = Message<"example.entity.ProcessManagerState"> & { id: string };
type FullVisibilityState = Message<"example.entity.FullVisibilityState"> & { id: string };
type HiddenState = Message<"example.entity.HiddenState"> & { id: string };

// Descriptor fixtures compiled from local test-only entity option protos.
const fileEntityMetadataFixture = fileDesc(
  "CiVleGFtcGxlL2VudGl0eV9tZXRhZGF0YV9maXh0dXJlLnByb3RvEg5leGFtcGxlLmVudGl0eRoTc3BpbmUvb3B0aW9ucy5wcm90byKLAQoPUHJvamVjdGlvblN0YXRlEhQKAmlkGAEgASgJQgSAhiQBUgJpZBIYCgRuYW1lGAIgASgJQgTwhyQBUgRuYW1lEiAKCHByaW9yaXR5GAMgASgFQgTwhyQBUghwcmlvcml0eTom+ookAggC2oskHAoaZXhhbXBsZS50YWdzLlByb2plY3Rpb25UYWcihwEKDkFnZ3JlZ2F0ZVN0YXRlEhQKAmlkGAEgASgJQgSAhiQBUgJpZBIYCgRuYW1lGAIgASgJQgTwhyQBUgRuYW1lEhwKCGFyY2hpdmVkGAMgASgIQgBSCGFyY2hpdmVkOif6iiQECAEQA9qLJBsKGWV4YW1wbGUudGFncy5BZ2dyZWdhdGVUYWciKAoMR2VuZXJpY1N0YXRlEhAKAmlkGAEgASgJQgBSAmlkOgb6iiQCCARCHNKNJBgSFmV4YW1wbGUudGFncy5TaGFyZWRUYWdiBnByb3RvMw==",
  [file_spine_options],
);
const ProjectionStateSchema = messageDesc(
  fileEntityMetadataFixture,
  0,
) as GenMessage<ProjectionState>;
const AggregateStateSchema = messageDesc(
  fileEntityMetadataFixture,
  1,
) as GenMessage<AggregateState>;
const GenericStateSchema = messageDesc(fileEntityMetadataFixture, 2) as GenMessage<GenericState>;

const fileEntityEmptyFixture = fileDesc(
  "CiJleGFtcGxlL2VudGl0eV9lbXB0eV9maXh0dXJlLnByb3RvEg5leGFtcGxlLmVudGl0eRoTc3BpbmUvb3B0aW9ucy5wcm90byIUCgpFbXB0eVN0YXRlOgb6iiQCCARCAGIGcHJvdG8z",
  [file_spine_options],
);
const EmptyStateSchema = messageDesc(fileEntityEmptyFixture, 0) as GenMessage<EmptyState>;

const fileEntityUnknownKindFixture = fileDesc(
  "CilleGFtcGxlL2VudGl0eV91bmtub3duX2tpbmRfZml4dHVyZS5wcm90bxIOZXhhbXBsZS5lbnRpdHkaE3NwaW5lL29wdGlvbnMucHJvdG8iKgoQVW5rbm93bktpbmRTdGF0ZRIQCgJpZBgBIAEoCUIAUgJpZDoE+ookAEIAYgZwcm90bzM=",
  [file_spine_options],
);
const UnknownKindStateSchema = messageDesc(
  fileEntityUnknownKindFixture,
  0,
) as GenMessage<UnknownKindState>;

const fileEntityInvalidColumnFixture = fileDesc(
  "CitleGFtcGxlL2VudGl0eV9pbnZhbGlkX2NvbHVtbl9maXh0dXJlLnByb3RvEg5leGFtcGxlLmVudGl0eRoTc3BpbmUvb3B0aW9ucy5wcm90byJIChJJbnZhbGlkQ29sdW1uU3RhdGUSEAoCaWQYASABKAlCAFICaWQSGAoEdGFncxgCIAMoCUIE8IckAVIEdGFnczoG+ookAggCQgBiBnByb3RvMw==",
  [file_spine_options],
);
const InvalidColumnStateSchema = messageDesc(
  fileEntityInvalidColumnFixture,
  0,
) as GenMessage<InvalidColumnState>;

const fileEntityInvalidTagFixture = fileDesc(
  "CihleGFtcGxlL2VudGl0eV9pbnZhbGlkX3RhZ19maXh0dXJlLnByb3RvEg5leGFtcGxlLmVudGl0eRoTc3BpbmUvb3B0aW9ucy5wcm90byIvCg9JbnZhbGlkVGFnU3RhdGUSEAoCaWQYASABKAlCAFICaWQ6CvqKJAIIBNqLJABCAGIGcHJvdG8z",
  [file_spine_options],
);
const InvalidTagStateSchema = messageDesc(
  fileEntityInvalidTagFixture,
  0,
) as GenMessage<InvalidTagState>;

const fileEntityVisibilityFixture = fileDesc(
  "CidleGFtcGxlL2VudGl0eV92aXNpYmlsaXR5X2ZpeHR1cmUucHJvdG8SDmV4YW1wbGUuZW50aXR5GhNzcGluZS9vcHRpb25zLnByb3RvIjEKE1Byb2Nlc3NNYW5hZ2VyU3RhdGUSEAoCaWQYASABKAlCAFICaWQ6CPqKJAQIAxACIjEKE0Z1bGxWaXNpYmlsaXR5U3RhdGUSEAoCaWQYASABKAlCAFICaWQ6CPqKJAQIBBAEIikKC0hpZGRlblN0YXRlEhAKAmlkGAEgASgJQgBSAmlkOgj6iiQECAQQAUIAYgZwcm90bzM=",
  [file_spine_options],
);
const ProcessManagerStateSchema = messageDesc(
  fileEntityVisibilityFixture,
  0,
) as GenMessage<ProcessManagerState>;
const FullVisibilityStateSchema = messageDesc(
  fileEntityVisibilityFixture,
  1,
) as GenMessage<FullVisibilityState>;
const HiddenStateSchema = messageDesc(fileEntityVisibilityFixture, 2) as GenMessage<HiddenState>;

describe("@spine-ts/server", () => {
  it("exports the descriptor-derived entity metadata surface", () => {
    expect(Object.keys(serverRoot).sort()).toEqual(
      ["DescriptorMetadataError", "describeEntityMetadata", "isEntitySchema"].sort(),
    );
  });

  it("extracts entity kind, default visibility, routing hints, columns, set-once fields, and tags", () => {
    const metadata = describeEntityMetadata(ProjectionStateSchema);

    expect(metadata.fullTypeName).toBe("example.entity.ProjectionState");
    expect(metadata.fileName).toBe("example/entity_metadata_fixture.proto");
    expect(metadata.kind).toBe("projection");
    expect(metadata.declaredVisibility).toBe("default");
    expect(metadata.visibility).toBe("full");
    expect(metadata.visibilitySource).toBe("default");
    expect(metadata.idField.name).toBe("id");
    expect(metadata.idField.number).toBe(1);
    expect(metadata.firstFieldRoutingHint.strategy).toBe("first-field");
    expect(metadata.firstFieldRoutingHint.field.name).toBe("id");
    expect(metadata.columns.map((field) => field.name)).toEqual(["name", "priority"]);
    expect(metadata.setOnceFields.map((field) => field.name)).toEqual(["id"]);
    expect(metadata.semanticTags).toEqual(["example.tags.ProjectionTag", "example.tags.SharedTag"]);
  });

  it("keeps explicit aggregate visibility and descriptor ordering deterministic", () => {
    const metadata = describeEntityMetadata(AggregateStateSchema);

    expect(metadata.kind).toBe("aggregate");
    expect(metadata.declaredVisibility).toBe("query");
    expect(metadata.visibility).toBe("query");
    expect(metadata.visibilitySource).toBe("explicit");
    expect(metadata.columns.map((field) => field.name)).toEqual(["name"]);
    expect(metadata.setOnceFields.map((field) => field.name)).toEqual(["id"]);
    expect(metadata.semanticTags).toEqual(["example.tags.AggregateTag", "example.tags.SharedTag"]);
  });

  it("normalizes the remaining supported entity kinds and visibility values", () => {
    expect(describeEntityMetadata(ProcessManagerStateSchema).kind).toBe("process-manager");
    expect(describeEntityMetadata(ProcessManagerStateSchema).visibility).toBe("subscribe");
    expect(describeEntityMetadata(FullVisibilityStateSchema).visibility).toBe("full");
    expect(describeEntityMetadata(HiddenStateSchema).visibility).toBe("none");
  });

  it("distinguishes entity schemas from non-entity schemas", () => {
    expect(isEntitySchema(ProjectionStateSchema)).toBe(true);
    expect(isEntitySchema(GenericStateSchema)).toBe(true);
    expect(isEntitySchema(CommandSchema)).toBe(false);
  });

  it("throws a descriptive error when entity metadata is required for a non-entity schema", () => {
    expect(() => describeEntityMetadata(CommandSchema)).toThrow(DescriptorMetadataError);
    expect(() => describeEntityMetadata(CommandSchema)).toThrow(/requires an \(entity\) option/);
  });

  it("throws clear errors for unsupported entity metadata combinations", () => {
    expect(() => describeEntityMetadata(EmptyStateSchema)).toThrow(
      /must declare at least one field for its ID and routing metadata/,
    );
    expect(() => describeEntityMetadata(UnknownKindStateSchema)).toThrow(
      /declares unsupported entity kind "KIND_UNKNOWN"/,
    );
    expect(() => describeEntityMetadata(InvalidColumnStateSchema)).toThrow(
      /column field "example\.entity\.InvalidColumnState\.tags" must be singular/,
    );
    expect(() => describeEntityMetadata(InvalidTagStateSchema)).toThrow(
      /semantic tag option "example\.entity\.InvalidTagState" must declare a non-empty java_type/,
    );
  });
});
