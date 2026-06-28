import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import { CommandSchema, file_spine_options } from "@spine-ts/proto";
import {
  serverEntityMetadataFixtureGeneration,
  serverEntityMetadataTestFixtures,
} from "../test-fixtures/entity-metadata-fixtures.js";

import * as serverRoot from "./index.js";
import { describeEntityMetadata, DescriptorMetadataError, isEntitySchema } from "./index.js";

type ProjectionState = Message<"ProjectionState"> & {
  id: string;
  name: string;
  priority: number;
};

type AggregateState = Message<"AggregateState"> & {
  id: string;
  name: string;
  archived: boolean;
};

type GenericState = Message<"GenericState"> & {
  id: string;
  searchable: boolean;
};

type EmptyState = Message<"EmptyState">;
type UnknownKindState = Message<"UnknownKindState"> & { id: string };
type InvalidColumnState = Message<"InvalidColumnState"> & {
  id: string;
  tags: string[];
};
type InvalidTagState = Message<"InvalidTagState"> & { id: string };
type ProcessManagerState = Message<"ProcessManagerState"> & { id: string; queue: string };
type FullVisibilityState = Message<"FullVisibilityState"> & { id: string };
type HiddenState = Message<"HiddenState"> & { id: string };

function createFixtureFileDescriptor(descriptorSetBase64: string, imports = [file_spine_options]) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];

  if (descriptor === undefined) {
    throw new Error("Server entity metadata fixture descriptor set is empty.");
  }

  return fileDesc(
    Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"),
    imports,
  );
}

// Descriptor fixtures are generated from checked-in test-only .proto sources.
const fileEntityMetadataFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.main.descriptorSetBase64,
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

const fileEntityEmptyFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.empty.descriptorSetBase64,
);
const EmptyStateSchema = messageDesc(fileEntityEmptyFixture, 0) as GenMessage<EmptyState>;

const fileEntityUnknownKindFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.unknownKind.descriptorSetBase64,
);
const UnknownKindStateSchema = messageDesc(
  fileEntityUnknownKindFixture,
  0,
) as GenMessage<UnknownKindState>;

const fileEntityInvalidColumnFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.invalidColumn.descriptorSetBase64,
);
const InvalidColumnStateSchema = messageDesc(
  fileEntityInvalidColumnFixture,
  0,
) as GenMessage<InvalidColumnState>;

const fileEntityInvalidTagFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.invalidTag.descriptorSetBase64,
);
const InvalidTagStateSchema = messageDesc(
  fileEntityInvalidTagFixture,
  0,
) as GenMessage<InvalidTagState>;

const fileEntityVisibilityFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.visibility.descriptorSetBase64,
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

    expect(metadata.fullTypeName).toBe("ProjectionState");
    expect(metadata.fileName).toBe("entity-metadata/main.proto");
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
    expect(metadata.columns).toEqual([]);
    expect(metadata.setOnceFields.map((field) => field.name)).toEqual(["id"]);
    expect(metadata.semanticTags).toEqual(["example.tags.AggregateTag", "example.tags.SharedTag"]);
  });

  it("normalizes the remaining supported entity kinds and visibility values", () => {
    const processManagerMetadata = describeEntityMetadata(ProcessManagerStateSchema);

    expect(processManagerMetadata.kind).toBe("process-manager");
    expect(processManagerMetadata.visibility).toBe("subscribe");
    expect(processManagerMetadata.columns.map((field) => field.name)).toEqual(["queue"]);
    expect(describeEntityMetadata(FullVisibilityStateSchema).visibility).toBe("full");
    expect(describeEntityMetadata(HiddenStateSchema).visibility).toBe("none");
  });

  it("ignores column declarations on entity kinds that are not column-eligible", () => {
    expect(describeEntityMetadata(AggregateStateSchema).columns).toEqual([]);
    expect(describeEntityMetadata(GenericStateSchema).columns).toEqual([]);
  });

  it("documents the checked-in fixture regeneration path", () => {
    expect(serverEntityMetadataFixtureGeneration.command).toBe(
      "node scripts/generate-server-test-fixtures.mjs",
    );
    expect(serverEntityMetadataFixtureGeneration.protoRoot).toBe(
      "packages/server/test-fixtures/proto/entity-metadata",
    );
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
      /column field "InvalidColumnState\.tags" must be singular/,
    );
    expect(() => describeEntityMetadata(InvalidTagStateSchema)).toThrow(
      /semantic tag option "InvalidTagState" must declare a non-empty java_type/,
    );
  });
});
