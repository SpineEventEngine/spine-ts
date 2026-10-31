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

import type { DescMessage } from "@bufbuild/protobuf";
import type { Schema } from "@bufbuild/protoplugin";

type QueryOutput = ReturnType<Schema["generateFile"]>;
interface QueryPair {
  readonly operation: DescMessage;
  readonly query: DescMessage;
  readonly response: DescMessage;
}

/**
 * Emits grouped application query declarations from the normal Proto plugin stage.
 */
export const AppQueryGenerator: Readonly<{
  generate(schema: Schema): void;
  pair(operation: DescMessage): QueryPair;
  emit(output: QueryOutput, pair: QueryPair): void;
}> = Object.freeze({
  /**
   * Generates paired query companions from eligible source files.
   *
   * @param schema The existing Buf plugin request and output writer.
   */
  generate(schema: Schema): void {
    for (const file of schema.files) {
      if (!file.proto.name.endsWith("_queries.proto")) continue;
      if (file.messages.length === 0) continue;
      const pairs = file.messages.map((operation) => AppQueryGenerator.pair(operation));
      const output = schema.generateFile(`${file.name}_app_query.ts`);
      output.preamble(file);
      for (const pair of pairs) AppQueryGenerator.emit(output, pair);
    }
  },

  /**
   * Finds the exact nested Query/Response pair in one operation.
   *
   * @param operation Top-level application query declaration.
   * @returns Its generated nested request and result descriptors.
   */
  pair(operation: DescMessage): QueryPair {
    const query = operation.nestedMessages.find((message) => message.name === "Query");
    const response = operation.nestedMessages.find((message) => message.name === "Response");
    if (query === undefined || response === undefined) {
      throw new Error(
        `spine-proto: ${operation.typeName} requires nested Query and Response messages`,
      );
    }
    return { operation, query, response };
  },

  /**
   * Emits grouped aliases and one literal request-to-result type association.
   *
   * @param output Generated companion file.
   * @param pair Validated Query and Response nested declarations.
   */
  emit(output: QueryOutput, { operation, query, response }: QueryPair): void {
    const queryType = output.importShape(query);
    const responseType = output.importShape(response);
    const querySchema = output.importSchema(query);
    const responseSchema = output.importSchema(response);
    output.print(
      `/**\n * Generated schemas and types for ${operation.name}.\n */\n`,
      `export namespace ${operation.name} {\n`,
      "/**\n * The application request message.\n */\nexport type Query = ",
      queryType,
      ";\n",
      "/**\n * The application result message.\n */\nexport type Response = ",
      responseType,
      ";\n",
      "/**\n * The generated request schema.\n */\nexport const querySchema: typeof ",
      querySchema,
      " = ",
      querySchema,
      ";\n",
      "/**\n * The generated result schema.\n */\nexport const responseSchema: typeof ",
      responseSchema,
      " = ",
      responseSchema,
      ";\n}\n",
      'declare module "@spine-event-engine/core" {\n',
      "  interface AppQueryResponses {\n    ",
      JSON.stringify(query.typeName),
      ": ",
      responseType,
      ";\n  }\n}\n",
    );
  },
});
