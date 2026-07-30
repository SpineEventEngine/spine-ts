#!/usr/bin/env node
import { getOption, hasOption } from "@bufbuild/protobuf";
import { createEcmaScriptPlugin, runNodeJs } from "@bufbuild/protoplugin";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import process from "node:process";
import { EntityFieldClassification } from "./entity-field-classification.mjs";

/** Generates typed Entity-column companions from Spine Protobuf input. */
export const EntityColumnGenerator = Object.freeze({
  /** Resolves Spine option descriptors supplied in the protoc plugin request.
   *
   * @param schema - Plugin schema containing input files and dependencies.
   * @returns The Entity and column option descriptors.
   */
  resolveOptions(schema) {
    let entity;
    let column;
    const pending = [...schema.allFiles];
    const visited = new Set();
    while (pending.length > 0) {
      const file = pending.pop();
      if (file === undefined || visited.has(file)) continue;
      visited.add(file);
      pending.push(...(file.dependencies ?? []));
      const descriptors = [...(file.extensions ?? []), ...schema.typesInFile(file)];
      for (const descriptor of descriptors) {
        if (descriptor.kind !== "extension") continue;
        if (
          descriptor.name === "entity" &&
          descriptor.extendee.typeName === "google.protobuf.MessageOptions" &&
          descriptor.file.proto.name === "spine/options.proto"
        ) {
          entity = descriptor;
        }
        if (
          descriptor.name === "column" &&
          descriptor.extendee.typeName === "google.protobuf.FieldOptions" &&
          descriptor.file.proto.name === "spine/options.proto"
        ) {
          column = descriptor;
        }
      }
    }
    if (entity === undefined || column === undefined) {
      throw new Error("The plugin request must include spine/options.proto descriptors.");
    }
    const kindField = entity.message.fields.find((field) => field.name === "kind");
    if (kindField?.fieldKind !== "enum") {
      throw new Error("The Spine entity option descriptor must declare entity kinds.");
    }
    return { entity, column };
  },

  /** Returns top-level queryable Entity messages in an input file.
   *
   * @param file - Protobuf file being generated.
   * @param options - Resolved Spine option descriptors.
   * @returns Queryable Entity message descriptors.
   */
  entities(file, options) {
    return file.messages.filter(
      (message) =>
        message.parent === undefined &&
        hasOption(message, options.entity) &&
        ["AGGREGATE", "PROJECTION", "PROCESS_MANAGER"].includes(
          options.entity.message.fields
            .find((field) => field.name === "kind")
            ?.enum?.values.find((value) => value.number === getOption(message, options.entity).kind)
            ?.name,
        ),
    );
  },

  /** Reports whether a field carries Spine's `(column) = true` option.
   *
   * @param field - Candidate Entity state field.
   * @param options - Resolved Spine option descriptors.
   * @returns Whether the field is queryable.
   */
  isColumn(field, options) {
    return hasOption(field, options.column) && getOption(field, options.column);
  },

  /** Derives the comparison family for a Protobuf field descriptor.
   *
   * @param field - Candidate queryable Entity field.
   * @returns The generated comparison family.
   */
  comparison(field) {
    const classification = EntityFieldClassification.classify(field);
    if (!classification.supported) {
      throw new TypeError(
        classification.reason === "singular"
          ? `Entity column "${field.localName}" must be singular; repeated and map fields are unsupported.`
          : `Entity column "${field.localName}" cannot belong to a oneof.`,
      );
    }
    return classification.comparison;
  },

  /** Generates deterministic companions for all queryable Entities in a request.
   *
   * @param schema - Plugin schema used to create generated files.
   * @returns Nothing after emitting zero or more companions.
   */
  generate(schema) {
    const candidateFiles = schema.files.filter((file) =>
      (file.proto.dependency ?? []).includes("spine/options.proto"),
    );
    if (candidateFiles.length === 0) return;
    const options = EntityColumnGenerator.resolveOptions(schema);
    for (const file of candidateFiles) {
      const entities = EntityColumnGenerator.entities(file, options);
      if (entities.length === 0) continue;

      const output = schema.generateFile(`${file.name}_columns.ts`);
      const generatedColumns = output.import(
        "GeneratedEntityColumns",
        "@spine-event-engine/client-node/codegen",
      );
      const definitionType = output.import(
        "EntityColumnDefinition",
        "@spine-event-engine/client-node/codegen",
        true,
      );
      output.preamble(file);

      for (const entity of entities) {
        const entitySchema = output.importSchema(entity);
        const columnFields = entity.fields.filter((field) =>
          EntityColumnGenerator.isColumn(field, options),
        );
        output.print(
          output.export("const", `${entity.name}ColumnDefinition`),
          ": ",
          definitionType,
          "<typeof ",
          entitySchema,
          ", {",
        );
        for (const field of columnFields) {
          output.print(
            `  readonly ${JSON.stringify(field.localName)}: { readonly field: typeof `,
            entitySchema,
            `.field[${JSON.stringify(field.localName)}]; readonly comparison: ${JSON.stringify(EntityColumnGenerator.comparison(field))} };`,
          );
        }
        output.print("}> = ", generatedColumns, ".define(", entitySchema, ", {");
        for (const field of columnFields) {
          output.print(
            `  ${JSON.stringify(field.localName)}: { field: `,
            entitySchema,
            `.field[${JSON.stringify(field.localName)}], comparison: ${JSON.stringify(EntityColumnGenerator.comparison(field))} },`,
          );
        }
        output.print("});");
      }
    }
  },
});

const entityColumnPlugin = createEcmaScriptPlugin({
  name: "protoc-gen-spine-entity-columns",
  version: "1.0.0",
  generateTs: EntityColumnGenerator.generate,
});

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runNodeJs(entityColumnPlugin);
}
