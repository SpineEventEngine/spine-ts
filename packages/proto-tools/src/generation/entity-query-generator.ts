/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import {
  getOption,
  hasOption,
  ScalarType,
  type DescExtension,
  type DescField,
  type DescFile,
  type DescMessage,
} from "@bufbuild/protobuf";
import { createEcmaScriptPlugin, runNodeJs, type Schema } from "@bufbuild/protoplugin";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

type QueryOutput = ReturnType<Schema["generateFile"]>;
type Imported = ReturnType<QueryOutput["import"]>;

interface QueryImports {
  readonly entityColumn: Imported;
  readonly columnTypes: Imported;
  readonly definitions: Imported;
  readonly queries: Imported;
  readonly builder: Imported;
}

const reservedMethods = new Set([
  "build",
  "byId",
  "constructor",
  "create",
  "either",
  "limit",
  "orderBy",
  "toString",
  "toLocaleString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "__proto__",
]);

/**
 * Generates query entry points beside eligible Entity state schemas.
 */
class EntityQueryGeneratorRuntime {
  /**
   * Creates registered columns and typed query factories from Proto descriptors.
   *
   * @param schema Buf plugin request and output writer.
   */
  generate(schema: Schema): void {
    const files = schema.files.filter((file) =>
      file.proto.dependency.includes("spine/options.proto"),
    );
    if (files.length === 0) return;
    const entity = EntityQueryGeneratorRuntime.#extension(schema.allFiles, "entity");
    const column = EntityQueryGeneratorRuntime.#extension(schema.allFiles, "column");
    for (const file of files) {
      EntityQueryGeneratorRuntime.#generateFile(schema, file, entity, column);
    }
  }

  /**
   * Finds a Spine option extension in request files or dependencies.
   *
   * @param files Descriptor files supplied to the plugin.
   * @param name Required option name.
   * @returns Matching extension descriptor.
   */
  static #extension(files: readonly DescFile[], name: string): DescExtension {
    const pending = [...files];
    const visited = new Set<DescFile>();
    while (pending.length > 0) {
      const file = pending.pop();
      if (file === undefined || visited.has(file)) continue;
      visited.add(file);
      pending.push(...file.dependencies);
      const found = file.extensions.find(
        (candidate) =>
          candidate.name === name && candidate.file.proto.name === "spine/options.proto",
      );
      if (found !== undefined) return found;
    }
    throw new Error(`spine-proto: missing (${name}) option descriptor`);
  }

  /**
   * Writes query factories for eligible top-level and nested Entity states in one Proto file.
   *
   * @param schema Plugin request and output writer.
   * @param file Source file descriptor.
   * @param entity Entity option extension.
   * @param column Column option extension.
   */
  static #generateFile(
    schema: Schema,
    file: DescFile,
    entity: DescExtension,
    column: DescExtension,
  ): void {
    const messages = EntityQueryGeneratorRuntime.#messages(file.messages).filter((message) =>
      EntityQueryGeneratorRuntime.#eligible(message, entity, column),
    );
    if (messages.length === 0) return;
    const output = schema.generateFile(`${file.name}_query.ts`);
    const imports = EntityQueryGeneratorRuntime.#imports(output);
    output.preamble(file);
    const names = new Set<string>();
    for (const message of messages) {
      const path = message.typeName.slice(file.proto.package.length + 1).replaceAll(".", "_");
      const base = `${path}Query`;
      let name = base;
      for (let suffix = 2; names.has(name); suffix += 1) name = `${base}_${String(suffix)}`;
      names.add(name);
      EntityQueryGeneratorRuntime.#emit(output, message, column, name, imports);
    }
  }

  /**
   * Checks that an Entity can be registered as a query without changing its descriptor.
   *
   * @param message Candidate Entity state.
   * @param entity Entity option extension.
   * @param column Column option extension.
   * @returns Whether the state and its marked columns support queries.
   */
  static #eligible(message: DescMessage, entity: DescExtension, column: DescExtension): boolean {
    if (!hasOption(message, entity)) return false;
    const kind = (getOption(message, entity) as { readonly kind?: unknown }).kind;
    if (kind !== 1 && kind !== 2 && kind !== 3) return false;
    for (const field of message.fields) {
      if (!hasOption(field, column) || getOption(field, column) !== true) continue;
      const reserved = ["version", "archived", "deleted"].includes(field.localName);
      const unsupported =
        field.fieldKind === "list" || field.fieldKind === "map" || field.oneof !== undefined;
      if (!reserved && !unsupported) continue;
      if (reserved)
        throw new TypeError(
          `Entity ${message.typeName} has reserved system column "${field.localName}".`,
        );
      throw new TypeError(
        `Entity ${message.typeName} column "${field.localName}" must be singular and outside a oneof.`,
      );
    }
    return true;
  }

  /**
   * Resolves browser-safe query helpers for a generated module.
   *
   * @param output Generated file writer.
   * @returns Imported value and type symbols.
   */
  static #imports(output: QueryOutput): QueryImports {
    return {
      entityColumn: output.import("EntityColumn", "@spine-event-engine/core"),
      columnTypes: output.import("EntityColumns", "@spine-event-engine/core", true),
      definitions: output.import("GeneratedEntityColumns", "@spine-event-engine/core/codegen"),
      queries: output.import("GeneratedEntityQueries", "@spine-event-engine/core/codegen"),
      builder: output.import("GeneratedQueryBuilder", "@spine-event-engine/core/codegen", true),
    };
  }

  /**
   * Lists nested messages in their descriptor declaration order.
   *
   * @param messages Messages declared at the current level.
   * @returns Every message at this level and below.
   */
  static #messages(messages: readonly DescMessage[]): readonly DescMessage[] {
    return messages.flatMap((message) => [
      message,
      ...EntityQueryGeneratorRuntime.#messages(message.nestedMessages),
    ]);
  }

  /**
   * Writes one query factory with registration retained by its exported value.
   *
   * @param output Generated file writer.
   * @param message Entity state descriptor.
   * @param column Column option extension.
   * @param name Collision-free exported query name.
   * @param imports Imported query and column helpers.
   */
  static #emit(
    output: QueryOutput,
    message: DescMessage,
    column: DescExtension,
    name: string,
    imports: QueryImports,
  ): void {
    const id = message.fields[0];
    if (id === undefined)
      throw new Error(`spine-proto: Entity ${message.typeName} has no ID field`);
    const state = output.importSchema(message);
    const fields = message.fields.filter(
      (field) => hasOption(field, column) && getOption(field, column) === true,
    );
    const columnsName = `${name}Columns`;
    EntityQueryGeneratorRuntime.#emitColumns(output, fields, columnsName, state, imports);
    EntityQueryGeneratorRuntime.#emitFactory(
      output,
      fields,
      name,
      columnsName,
      state,
      id.localName,
      imports,
    );
  }

  /**
   * Writes typed registration for every marked state column.
   *
   * @param output Generated file writer.
   * @param fields Marked state fields.
   * @param columnsName Local registered-column variable name.
   * @param state Imported state schema.
   * @param imports Imported registration helpers.
   */
  static #emitColumns(
    output: QueryOutput,
    fields: readonly DescField[],
    columnsName: string,
    state: Imported,
    imports: QueryImports,
  ): void {
    output.print(`const ${columnsName}: `, imports.columnTypes, "<typeof ", state, ", {");
    EntityQueryGeneratorRuntime.#emitColumnEntries(output, fields, state, true);
    output.print(
      "}> = ",
      imports.entityColumn,
      ".register(",
      state,
      ", ",
      imports.definitions,
      ".define(",
      state,
      ", {",
    );
    EntityQueryGeneratorRuntime.#emitColumnEntries(output, fields, state, false);
    output.print("}));");
  }

  /**
   * Writes either precise column types or matching runtime metadata entries.
   *
   * @param output Generated file writer.
   * @param fields Marked state fields.
   * @param state Imported state schema.
   * @param typed Whether to write declared types instead of values.
   */
  static #emitColumnEntries(
    output: QueryOutput,
    fields: readonly DescField[],
    state: Imported,
    typed: boolean,
  ): void {
    for (const field of fields) {
      const key = JSON.stringify(field.localName);
      const comparison = JSON.stringify(EntityQueryGeneratorRuntime.#comparison(field));
      output.print(
        typed ? `  readonly ${key}: { readonly field: typeof ` : `  ${key}: { field: `,
        state,
        `.field[${key}]`,
        typed ? "; readonly comparison: " : ", comparison: ",
        comparison,
        typed ? " };" : " },",
      );
    }
  }

  /**
   * Writes a typed factory whose value uses the registered columns.
   *
   * @param output Generated file writer.
   * @param fields Marked state fields.
   * @param name Exported query factory name.
   * @param columnsName Local registered-column variable name.
   * @param state Imported state schema.
   * @param idField First field's local name.
   * @param imports Imported query helpers.
   */
  static #emitFactory(
    output: QueryOutput,
    fields: readonly DescField[],
    name: string,
    columnsName: string,
    state: Imported,
    idField: string,
    imports: QueryImports,
  ): void {
    const accessors = EntityQueryGeneratorRuntime.#accessors(fields);
    output.print(
      output.export("const", name),
      ": Readonly<{ create(): ",
      imports.builder,
      "<typeof ",
      state,
      `, typeof ${columnsName}, ${JSON.stringify(idField)}, {`,
    );
    for (const accessor of accessors) {
      output.print(
        `  readonly ${JSON.stringify(accessor.method)}: ${JSON.stringify(accessor.field)};`,
      );
    }
    output.print(
      "}> }> = ",
      imports.queries,
      ".define({ schema: ",
      state,
      `, columns: ${columnsName}, idField: ${JSON.stringify(idField)}, accessors: {`,
    );
    for (const accessor of accessors) {
      output.print(`  ${JSON.stringify(accessor.method)}: ${JSON.stringify(accessor.field)},`);
    }
    output.print("} });");
  }

  /**
   * Maps declared and lifecycle columns to deterministic safe accessor names.
   *
   * @param fields Marked state fields.
   * @returns Method names paired with registered column names.
   */
  static #accessors(
    fields: readonly DescField[],
  ): readonly { readonly method: string; readonly field: string }[] {
    const used = new Set(reservedMethods);
    const accessors: { readonly method: string; readonly field: string }[] = [];
    for (const column of [
      ...fields.map((entry) => ({
        field: entry.localName,
        candidate: entry.name === "constructor" ? "constructor" : entry.localName,
      })),
      { field: "version", candidate: "version" },
      { field: "archived", candidate: "archived" },
      { field: "deleted", candidate: "deleted" },
    ]) {
      let method = column.candidate;
      if (used.has(method)) method = `${method}Column`;
      const base = method;
      for (let suffix = 2; used.has(method); suffix += 1) method = `${base}${String(suffix)}`;
      used.add(method);
      accessors.push({ method, field: column.field });
    }
    return accessors;
  }

  /**
   * Determines the comparison supported by one singular column field.
   *
   * @param field Protobuf field marked as an Entity column.
   * @returns Equality or ordered comparison family.
   */
  static #comparison(field: DescField): "equality" | "ordering" {
    if (field.fieldKind === "list" || field.fieldKind === "map" || field.oneof !== undefined) {
      throw new TypeError(
        `Entity column "${field.localName}" must be singular and outside a oneof.`,
      );
    }
    if (
      field.fieldKind === "enum" ||
      field.scalar === ScalarType.BOOL ||
      field.scalar === ScalarType.BYTES
    )
      return "equality";
    if (field.fieldKind === "message") {
      return field.message.typeName === "google.protobuf.Timestamp" ||
        field.message.typeName === "spine.core.Version"
        ? "ordering"
        : "equality";
    }
    return "ordering";
  }
}

/**
 * Generates query companions from a Buf request.
 */
export const EntityQueryGenerator: Readonly<Pick<EntityQueryGeneratorRuntime, "generate">> =
  Object.freeze(new EntityQueryGeneratorRuntime());

const plugin = createEcmaScriptPlugin({
  name: "protoc-gen-spine-entity-query",
  version: "1.0.0",

  generateTs: (schema) => {
    EntityQueryGenerator.generate(schema);
  },
});

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runNodeJs(plugin);
}
