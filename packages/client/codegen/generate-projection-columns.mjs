#!/usr/bin/env node
import { getOption, hasOption } from "@bufbuild/protobuf";
import { createEcmaScriptPlugin, runNodeJs } from "@bufbuild/protoplugin";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import process from "node:process";
import { classifyProjectionField } from "./projection-field-classification.mjs";

/** Resolve Spine option descriptors supplied in the protoc plugin request. */
export function resolveSpineOptionDescriptors(schema) {
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
  const projection = kindField?.enum?.values.find((value) => value.name === "PROJECTION");
  if (kindField?.fieldKind !== "enum" || projection === undefined) {
    throw new Error("The Spine entity option descriptor must declare the PROJECTION kind.");
  }
  return { entity, column, projectionKind: projection.number };
}

/** Return top-level Projection messages declared in a generated file. */
export function projectionMessages(file, options) {
  return file.messages.filter(
    (message) =>
      message.parent === undefined &&
      hasOption(message, options.entity) &&
      getOption(message, options.entity).kind === options.projectionKind,
  );
}

/** Return whether a field carries Spine's `(column) = true` option. */
export function isColumnField(field, options) {
  return hasOption(field, options.column) && getOption(field, options.column);
}

/** Derive the generated comparison family from a Protobuf field descriptor. */
export function columnComparison(field) {
  const classification = classifyProjectionField(field);
  if (!classification.supported) {
    throw new TypeError(
      classification.reason === "singular"
        ? `Projection column "${field.localName}" must be singular; repeated and map fields are unsupported.`
        : `Projection column "${field.localName}" cannot belong to a oneof.`,
    );
  }
  return classification.comparison;
}

/** Generate one deterministic companion per source file containing Projections. */
export function generateProjectionColumnCompanions(schema) {
  const candidateFiles = schema.files.filter((file) =>
    (file.proto.dependency ?? []).includes("spine/options.proto"),
  );
  if (candidateFiles.length === 0) return;
  const options = resolveSpineOptionDescriptors(schema);
  for (const file of candidateFiles) {
    const projections = projectionMessages(file, options);
    if (projections.length === 0) continue;

    const output = schema.generateFile(`${file.name}_columns.ts`);
    const defineColumns = output.import(
      "defineGeneratedProjectionColumns",
      "@spine-event-engine/client/codegen",
    );
    const definitionType = output.import(
      "ProjectionColumnDefinition",
      "@spine-event-engine/client/codegen",
      true,
    );
    output.preamble(file);

    for (const projection of projections) {
      const projectionSchema = output.importSchema(projection);
      const columnFields = projection.fields.filter((field) => isColumnField(field, options));
      output.print(
        output.export("const", `${projection.name}ColumnDefinition`),
        ": ",
        definitionType,
        "<typeof ",
        projectionSchema,
        ", {",
      );
      for (const field of columnFields) {
        output.print(
          `  readonly ${JSON.stringify(field.localName)}: { readonly field: typeof `,
          projectionSchema,
          `.field[${JSON.stringify(field.localName)}]; readonly comparison: ${JSON.stringify(columnComparison(field))} };`,
        );
      }
      output.print("}> = ", defineColumns, "(", projectionSchema, ", {");
      for (const field of columnFields) {
        output.print(
          `  ${JSON.stringify(field.localName)}: { field: `,
          projectionSchema,
          `.field[${JSON.stringify(field.localName)}], comparison: ${JSON.stringify(columnComparison(field))} },`,
        );
      }
      output.print("});");
    }
  }
}

const projectionColumnPlugin = createEcmaScriptPlugin({
  name: "protoc-gen-spine-projection-columns",
  version: "1.0.0",
  generateTs: generateProjectionColumnCompanions,
});

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runNodeJs(projectionColumnPlugin);
}
