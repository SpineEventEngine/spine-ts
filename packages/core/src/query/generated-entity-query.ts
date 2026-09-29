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

import type { Message, MessageShape } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import {
  EntityColumn,
  type EntityColumnOperator,
  type EntityColumnValue,
} from "../entity/entity-column.js";
import {
  EntityQuery,
  type EntityPredicate,
  type EntityQueryDescription,
  type EntityQueryDraft,
  type EntityColumnCollection,
} from "./entity-query.js";

/**
 * Fluent comparison methods emitted for one registered Entity column.
 *
 * @typeParam Column Registered column compared by these methods.
 * @typeParam Builder Query builder returned after a condition is added.
 */
export type GeneratedQueryComparison<Column extends EntityColumn, Builder> = {
  /**
   * Adds an equality condition for this column.
   *
   * @param value Value compared with the column.
   * @returns Builder with the new condition.
   */
  is(value: Exclude<EntityColumnValue<Column>, undefined>): Builder;
} & ("greaterThan" extends EntityColumnOperator<Column>
  ? {
      /**
       * Adds an exclusive lower bound for an ordered column.
       *
       * @param value Lower bound.
       * @returns Builder with the new condition.
       */
      isGreaterThan(value: Exclude<EntityColumnValue<Column>, undefined>): Builder;

      /**
       * Adds an inclusive lower bound for an ordered column.
       *
       * @param value Inclusive lower bound.
       * @returns Builder with the new condition.
       */
      isAtLeast(value: Exclude<EntityColumnValue<Column>, undefined>): Builder;

      /**
       * Adds an exclusive upper bound for an ordered column.
       *
       * @param value Upper bound.
       * @returns Builder with the new condition.
       */
      isLessThan(value: Exclude<EntityColumnValue<Column>, undefined>): Builder;

      /**
       * Adds an inclusive upper bound for an ordered column.
       *
       * @param value Inclusive upper bound.
       * @returns Builder with the new condition.
       */
      isAtMost(value: Exclude<EntityColumnValue<Column>, undefined>): Builder;
    }
  : object);

/**
 * Adds declared fluent methods to a generated builder.
 *
 * @typeParam Schema State schema queried by the builder.
 * @typeParam Columns Registered columns for that state.
 * @typeParam Name First identifier field's local name.
 * @typeParam Methods Accessor names mapped to registered columns.
 */
type Accessors<
  Schema extends GenMessage<Message>,
  Columns extends EntityColumnCollection<Schema>,
  Name extends keyof MessageShape<Schema> & string,
  Methods extends Readonly<Record<string, keyof Columns & string>>,
> = {
  readonly [Method in keyof Methods]: () => GeneratedQueryComparison<
    Columns[Methods[Method]],
    GeneratedQueryFlow<Schema, Columns, Name, Methods> & Accessors<Schema, Columns, Name, Methods>
  >;
};

/**
 * Rejects callbacks whose inferred return includes an asynchronous result.
 *
 * @typeParam Builder Condition-only builder passed to each callback.
 * @typeParam Branches Inferred callback tuple.
 */
type SynchronousBranches<Builder, Branches extends readonly ((query: Builder) => unknown)[]> =
  Extract<ReturnType<Branches[number]>, PromiseLike<unknown>> extends never ? Branches : never;

/**
 * Exposes comparisons and nested disjunctions inside an either branch.
 *
 * @typeParam Schema State schema queried by the outer builder.
 * @typeParam Columns Registered columns for that state.
 * @typeParam Methods Accessor names mapped to registered columns.
 */
export type GeneratedConditionBuilder<
  Schema extends GenMessage<Message>,
  Columns extends EntityColumnCollection<Schema>,
  Methods extends Readonly<Record<string, keyof Columns & string>>,
> = {
  readonly [Method in keyof Methods]: () => GeneratedQueryComparison<
    Columns[Methods[Method]],
    GeneratedConditionBuilder<Schema, Columns, Methods>
  >;
} & {
  /**
   * Adds nested OR branches formed only from conditions.
   *
   * @typeParam Branches Synchronous callbacks constructing the alternatives.
   * @param branches Synchronous condition callbacks.
   * @returns This condition builder.
   */
  either<
    const Branches extends readonly ((
      query: GeneratedConditionBuilder<Schema, Columns, Methods>,
    ) => unknown)[],
  >(
    ...branches: SynchronousBranches<GeneratedConditionBuilder<Schema, Columns, Methods>, Branches>
  ): GeneratedConditionBuilder<Schema, Columns, Methods>;
};

/**
 * Selects generated accessor names whose columns support ordering.
 *
 * @typeParam Schema State schema queried by the builder.
 * @typeParam Columns Registered columns for that state.
 * @typeParam Methods Accessor names mapped to registered columns.
 */
type OrderedMethod<
  Schema extends GenMessage<Message>,
  Columns extends EntityColumnCollection<Schema>,
  Methods extends Readonly<Record<string, keyof Columns & string>>,
> = {
  [Method in keyof Methods]: "greaterThan" extends EntityColumnOperator<Columns[Methods[Method]]>
    ? Method
    : never;
}[keyof Methods] &
  string;

/**
 * Typed generated query builder with declared fluent field accessors.
 *
 * @typeParam Schema Generated Entity state schema.
 * @typeParam Columns Registered columns for that state.
 * @typeParam Name Local name of the first identifier field.
 * @typeParam Methods Generated accessor names and their registered columns.
 */
export type GeneratedQueryBuilder<
  Schema extends GenMessage<Message>,
  Columns extends EntityColumnCollection<Schema>,
  Name extends keyof MessageShape<Schema> & string,
  Methods extends Readonly<Record<string, keyof Columns & string>>,
> = GeneratedQueryFlow<Schema, Columns, Name, Methods> & Accessors<Schema, Columns, Name, Methods>;

/**
 * Applies generated column accessors to the common context-free query compiler.
 *
 * @typeParam Schema Generated Entity state schema.
 * @typeParam Columns Registered columns for that state.
 * @typeParam Name Local name of the first identifier field.
 * @typeParam Methods Generated accessor names and their registered columns.
 */
export class GeneratedQueryFlow<
  Schema extends GenMessage<Message>,
  Columns extends EntityColumnCollection<Schema>,
  Name extends keyof MessageShape<Schema> & string,
  Methods extends Readonly<Record<string, keyof Columns & string>>,
> {
  readonly #input: {
    readonly schema: Schema;
    readonly columns: Columns;
    readonly idField: Name;
    readonly accessors: Methods;
  };

  readonly #draft: EntityQueryDraft<Schema, Columns, Name>;

  readonly #predicates: EntityPredicate[] = [];

  readonly #branchOnly: boolean;

  /**
   * Creates a query flow from generated schema and accessor metadata.
   *
   * @param input Generated schema, columns, ID field, and accessor mapping.
   * @param branchOnly Whether this flow is restricted to condition construction.
   */
  constructor(
    input: {
      readonly schema: Schema;
      readonly columns: Columns;
      readonly idField: Name;
      readonly accessors: Methods;
    },
    branchOnly = false,
  ) {
    this.#input = input;
    this.#branchOnly = branchOnly;
    this.#draft = EntityQuery.describe(input);
    for (const [method, columnName] of Object.entries(input.accessors)) {
      if (method in this || !Object.hasOwn(input.columns, columnName)) {
        throw new TypeError(`Entity query accessor "${method}" is invalid.`);
      }
      Object.defineProperty(this, method, {
        value: () => this.#comparison(input.columns[columnName] as EntityColumn),
        enumerable: true,
      });
    }
  }

  /**
   * Adds one or more identifiers to the query.
   *
   * @param ids Values of the state's first declared field.
   * @returns This builder.
   */
  byId(...ids: readonly Exclude<MessageShape<Schema>[Name], undefined>[]): this {
    this.#requireRoot("byId");
    this.#draft.byId(...ids);
    return this;
  }

  /**
   * Adds a disjunction of independent generated condition branches.
   *
   * @typeParam Branches Synchronous callbacks constructing the alternatives.
   * @param branches Callbacks that add one or more conditions to fresh branches.
   * @returns This builder with the combined disjunction.
   */
  either<
    const Branches extends readonly ((
      query: GeneratedConditionBuilder<Schema, Columns, Methods>,
    ) => unknown)[],
  >(
    ...branches: SynchronousBranches<GeneratedConditionBuilder<Schema, Columns, Methods>, Branches>
  ): this {
    if (branches.length < 2) throw new TypeError("Entity query either requires two branches.");
    const predicates = branches.map((branch) => {
      const query = new GeneratedQueryFlow(this.#input, true);
      const result: unknown = branch(
        query as unknown as GeneratedConditionBuilder<Schema, Columns, Methods>,
      );
      if (
        result !== undefined &&
        result !== null &&
        typeof result === "object" &&
        "then" in result &&
        typeof result.then === "function"
      ) {
        void Promise.resolve(result).catch(() => undefined);
        throw new TypeError("Entity query either branches must be synchronous.");
      }
      return query.#combined();
    });
    const first = predicates[0];
    if (first === undefined) throw new TypeError("Entity query either requires two branches.");
    this.#append(EntityQuery.either(first, ...predicates.slice(1)));
    return this;
  }

  /**
   * Adds ordering by a generated accessor for an ordered column.
   *
   * @param method Generated accessor name for an ordered column.
   * @param direction Ascending or descending direction.
   * @returns This builder.
   */
  orderBy(
    method: OrderedMethod<Schema, Columns, Methods>,
    direction: "asc" | "desc" = "asc",
  ): this {
    this.#requireRoot("orderBy");
    const name = this.#input.accessors[method] as keyof Columns & string;
    const column = this.#input.columns[name] as EntityColumn;
    this.#draft.orderBy(column as never, direction);
    return this;
  }

  /**
   * Sets a positive explicit result limit after ordering.
   *
   * @param value Maximum number of matching states.
   * @returns This builder.
   */
  limit(value: number): this {
    this.#requireRoot("limit");
    this.#draft.limit(value);
    return this;
  }

  /**
   * Builds a detached context-free query description.
   *
   * @returns Query value usable by PM, client, and later repository reads.
   */
  build(): EntityQueryDescription<Schema, Exclude<MessageShape<Schema>[Name], undefined>> {
    this.#requireRoot("build");
    return this.#draft.build();
  }

  /**
   * Rejects outer-query operations inside a condition branch.
   *
   * @param operation Outer-query operation attempted in the branch.
   */
  #requireRoot(operation: string): void {
    if (this.#branchOnly) {
      throw new TypeError(`Entity query either branch cannot call ${operation}.`);
    }
  }

  /**
   * Appends a compiled predicate to this draft and its branch history.
   *
   * @param predicate Comparison or group predicate to append.
   */
  #append(predicate: EntityPredicate): void {
    this.#draft.where(predicate as never);
    this.#predicates.push(predicate);
  }

  /**
   * Combines this branch's successive conditions with conjunction.
   *
   * @returns Single condition or a conjunction of branch conditions.
   */
  #combined(): EntityPredicate {
    const first = this.#predicates[0];
    if (first === undefined) throw new TypeError("Entity query either branch has no conditions.");
    return this.#predicates.length === 1
      ? first
      : EntityQuery.all(first, ...this.#predicates.slice(1));
  }

  /**
   * Creates only the comparison methods supported by a registered column.
   *
   * @param column Registered column selected by an accessor.
   * @returns Bound comparison methods for this builder.
   */
  #comparison(column: EntityColumn): GeneratedQueryComparison<EntityColumn, this> {
    const add = (operator: EntityColumnOperator<EntityColumn>, value: unknown) => {
      const predicate = Object.freeze({
        kind: "comparison",
        column,
        operator,
        value,
      }) as EntityPredicate;
      this.#append(predicate);
      return this;
    };
    const comparison = { is: (value: unknown) => add("equal", value) } as Record<string, unknown>;
    if (column.comparison === "ordering") {
      comparison.isGreaterThan = (value: unknown) => add("greaterThan", value);
      comparison.isAtLeast = (value: unknown) => add("greaterOrEqual", value);
      comparison.isLessThan = (value: unknown) => add("lessThan", value);
      comparison.isAtMost = (value: unknown) => add("lessOrEqual", value);
    }
    return Object.freeze(comparison) as GeneratedQueryComparison<EntityColumn, this>;
  }
}

/**
 * Creates typed generated query entry points from emitted accessor metadata.
 */
interface GeneratedEntityQueryFactory {
  /**
   * Binds a state schema and registered columns to a ready-to-import query factory.
   *
   * @typeParam Schema Generated Entity state schema.
   * @typeParam Columns Registered columns for that state.
   * @typeParam Name Local name of the first identifier field.
   * @typeParam Methods Emitted accessor names mapped to registered columns.
   * @param input Schema, columns, ID field, and generated accessor names.
   * @returns Factory that creates independent typed query builders.
   */
  define<
    Schema extends GenMessage<Message>,
    Columns extends EntityColumnCollection<Schema>,
    Name extends keyof MessageShape<Schema> & string,
    const Methods extends Readonly<Record<string, keyof Columns & string>>,
  >(input: {
    readonly schema: Schema;
    readonly columns: Columns;
    readonly idField: Name;
    readonly accessors: Methods;
  }): Readonly<{
    /**
     * Creates an independent builder for the registered state.
     *
     * @returns A fresh typed query builder.
     */
    create(): GeneratedQueryBuilder<Schema, Columns, Name, Methods>;
  }>;
}

/**
 * Creates typed generated query entry points from emitted accessor metadata.
 */
export const GeneratedEntityQueries: Readonly<GeneratedEntityQueryFactory> = Object.freeze({
  /**
   * Binds a state schema and registered columns to a ready-to-import query factory.
   *
   * @typeParam Schema Generated Entity state schema.
   * @typeParam Columns Registered columns for that state.
   * @typeParam Name Local name of the first identifier field.
   * @typeParam Methods Emitted accessor names mapped to registered columns.
   * @param input Schema, columns, ID field, and generated accessor names.
   * @returns Factory that creates independent typed query builders.
   */
  define<
    Schema extends GenMessage<Message>,
    Columns extends EntityColumnCollection<Schema>,
    Name extends keyof MessageShape<Schema> & string,
    const Methods extends Readonly<Record<string, keyof Columns & string>>,
  >(input: {
    readonly schema: Schema;
    readonly columns: Columns;
    readonly idField: Name;
    readonly accessors: Methods;
  }): Readonly<{ create(): GeneratedQueryBuilder<Schema, Columns, Name, Methods> }> {
    return Object.freeze({
      create: () =>
        new GeneratedQueryFlow(input) as GeneratedQueryBuilder<Schema, Columns, Name, Methods>,
    });
  },
});
