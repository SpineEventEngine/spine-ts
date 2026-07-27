import { describe, expect, it } from "vitest";

import {
  columnComparison,
  generateEntityColumnCompanions,
  isColumnField,
  entityMessages,
  resolveSpineOptionDescriptors,
} from "../packages/client-node/codegen/generate-entity-columns.mjs";
import { column, entity } from "../packages/proto/src/index.ts";
import {
  AggregateStateSchema,
  ProjectionStateSchema,
  projectionFieldWithRawColumnOption,
  projectionSchemaWithRawEntityOption,
  ProcessManagerStateSchema,
} from "../packages/client-node/test-fixtures/entity-column-fixtures.ts";

const columnOption = {
  $unknown: [{ no: column.number, wireType: 0, data: new Uint8Array([1]) }],
};
const spineOptions = resolveSpineOptionDescriptors({
  allFiles: [{}],
  typesInFile: () => [entity, column],
});
const scalarBool = 8;
const scalarString = 9;

describe("Entity column companion generator", () => {
  it("selects top-level Aggregate, Projection, and Process Manager messages with annotated fields", () => {
    const nested = { ...ProjectionStateSchema, parent: ProjectionStateSchema };

    expect(
      entityMessages(
        {
          messages: [
            ProjectionStateSchema,
            AggregateStateSchema,
            ProcessManagerStateSchema,
            nested,
          ],
        },
        spineOptions,
      ),
    ).toEqual([ProjectionStateSchema, AggregateStateSchema, ProcessManagerStateSchema]);
    expect(isColumnField(ProjectionStateSchema.field.title, spineOptions)).toBe(true);
    expect(isColumnField(ProjectionStateSchema.field.note, spineOptions)).toBe(false);
  });

  it("resolves Spine option descriptors from the plugin request", () => {
    expect(
      resolveSpineOptionDescriptors({
        allFiles: [{}],
        typesInFile: () => [entity, column],
      }),
    ).toEqual(spineOptions);
    expect(() => resolveSpineOptionDescriptors({ allFiles: [{}], typesInFile: () => [] })).toThrow(
      /must include spine\/options\.proto descriptors/,
    );
  });

  it("discovers entity kinds from the entity option enum descriptor", () => {
    const remappedEntity = {
      ...entity,
      message: {
        ...entity.message,
        fields: entity.message.fields.map((field) =>
          field.name === "kind"
            ? {
                ...field,
                enum: {
                  ...field.enum,
                  values: field.enum.values.map((value) =>
                    value.name === "PROJECTION" ? { ...value, number: 77 } : value,
                  ),
                },
              }
            : field,
        ),
      },
    };

    expect(
      resolveSpineOptionDescriptors({
        allFiles: [{}],
        typesInFile: () => [remappedEntity, column],
      }).entity,
    ).toBe(remappedEntity);
  });

  it("maps descriptor kinds to deterministic comparison families", () => {
    expect(columnComparison(scalarField("title", scalarString, columnOption))).toBe("ordering");
    expect(columnComparison(scalarField("active", scalarBool, columnOption))).toBe("equality");
    expect(
      columnComparison({
        fieldKind: "message",
        message: { typeName: "google.protobuf.Timestamp" },
      }),
    ).toBe("ordering");
    expect(
      columnComparison({ fieldKind: "message", message: { typeName: "spine.core.Version" } }),
    ).toBe("ordering");
    expect(columnComparison({ fieldKind: "message", message: { typeName: "acme.Owner" } })).toBe(
      "equality",
    );
    expect(columnComparison({ fieldKind: "enum" })).toBe("equality");
    expect(() => columnComparison({ fieldKind: "list", localName: "tags" })).toThrow(
      /must be singular/,
    );
  });

  it("rejects truncated or trailing custom-option payloads", () => {
    const malformedEntity = projectionSchemaWithRawEntityOption(bytes(4, 8, 2));
    expect(() => entityMessages({ messages: [malformedEntity] }, spineOptions)).toThrow();
    const trailingEntity = projectionSchemaWithRawEntityOption(bytes(3, 8, 2, 0));
    expect(() => entityMessages({ messages: [trailingEntity] }, spineOptions)).toThrow();
    expect(() =>
      isColumnField(projectionFieldWithRawColumnOption(bytes(0x80)), spineOptions),
    ).toThrow();
  });

  it("emits a codegen-subpath companion with exact local names", () => {
    const output = generatedOutput();
    const generatedFiles = [];

    generateEntityColumnCompanions({
      allFiles: [{}],
      typesInFile: () => [entity, column],
      files: [
        {
          name: "spine/example/todo/v1/task_list",
          proto: {
            name: "spine/example/todo/v1/task_list.proto",
            dependency: ["spine/options.proto"],
          },
          messages: [AggregateStateSchema, ProjectionStateSchema, ProcessManagerStateSchema],
        },
      ],
      generateFile(name) {
        generatedFiles.push(name);
        return output;
      },
    });

    expect(generatedFiles).toEqual(["spine/example/todo/v1/task_list_columns.ts"]);
    expect(output.imports).toContainEqual({
      from: "@spine-event-engine/client-node/codegen",
      name: "defineGeneratedEntityColumns",
    });
    const source = output.printed.flat().join("");
    expect(source).toContain("ProjectionStateColumnDefinition");
    expect(source).toContain("AggregateStateColumnDefinition");
    expect(source).toContain("ProcessManagerStateColumnDefinition");
    expect(source).toContain('"title"');
    expect(source).not.toContain('"note"');
  });

  it("does not create a companion for files without queryable entities", () => {
    const generatedFiles = [];
    generateEntityColumnCompanions({
      allFiles: [{}],
      typesInFile: () => [entity, column],
      files: [{ name: "acme/messages", proto: { name: "acme/messages.proto" }, messages: [] }],
      generateFile(name) {
        generatedFiles.push(name);
        return generatedOutput();
      },
    });
    expect(generatedFiles).toEqual([]);
  });
});

function bytes(...values) {
  return new Uint8Array(values);
}

function scalarField(localName, scalar, options) {
  return { localName, fieldKind: "scalar", scalar, proto: { options } };
}

function generatedOutput() {
  const imports = [];
  const printed = [];
  return {
    imports,
    printed,
    export(_declaration, name) {
      return `export const ${name}`;
    },
    import(name, from) {
      imports.push({ from, name });
      return name;
    },
    importSchema(message) {
      return `${message.name}Schema`;
    },
    preamble() {},
    print(...parts) {
      printed.push(parts);
    },
  };
}
