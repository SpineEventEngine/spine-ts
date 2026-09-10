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

import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import {
  EntityColumn as CoreEntityColumn,
  type EntityColumn as CoreEntityColumnType,
  type EntityColumnDefinition as CoreEntityColumnDefinition,
  type EntityColumnDefinitionEntry as CoreColumnDefinitionEntry,
  type EntityColumnOperator as CoreEntityColumnOperator,
  type EntityColumnValue as CoreEntityColumnValue,
  type EntityColumnValueKind as CoreColumnValueKind,
  type EntityColumns as CoreEntityColumns,
  type EntityComparison as CoreEntityComparison,
  type EntityEqualityOperator as CoreEntityEqualityOperator,
  type EntityOrderingOperator as CoreEntityOrderingOperator,
} from "@spine-event-engine/core";
import { GeneratedEntityColumns } from "@spine-event-engine/core/codegen";

/**
 * Operators available for every Entity column.
 */
export type EntityEqualityOperator = CoreEntityEqualityOperator;

/**
 * Operators available for naturally ordered Entity column values.
 */
export type EntityOrderingOperator = CoreEntityOrderingOperator;

/**
 * Comparison family derived from a column's Protobuf field descriptor.
 */
export type EntityComparison = CoreEntityComparison;

/**
 * Runtime value category derived from a column's Protobuf field descriptor.
 */
export type EntityColumnValueKind = CoreColumnValueKind;

/**
 * Represents one generated column declaration paired with its descriptor.
 *
 * @typeParam Comparison Comparison family supported by the column.
 */
export type EntityColumnDefinitionEntry<Comparison extends EntityComparison = EntityComparison> =
  CoreColumnDefinitionEntry<Comparison>;

/**
 * Describes descriptor-backed column metadata emitted next to an Entity schema.
 *
 * @typeParam Schema Generated Protobuf schema that owns the columns.
 * @typeParam Entries Generated column entries for the schema.
 */
export type EntityColumnDefinition<
  Schema extends GenMessage<Message>,
  Entries extends Readonly<Record<string, EntityColumnDefinitionEntry>>,
> = CoreEntityColumnDefinition<Schema, Entries>;

/**
 * Represents the typed column collection returned for one generated Entity definition.
 *
 * @typeParam Schema Generated Protobuf schema that owns the columns.
 * @typeParam Entries Generated column entries for the schema.
 */
export type EntityColumns<
  Schema extends GenMessage<Message>,
  Entries extends Readonly<Record<string, EntityColumnDefinitionEntry>>,
> = CoreEntityColumns<Schema, Entries>;

/**
 * Extracts the value type carried by an Entity column.
 *
 * @typeParam Column Entity column whose value type is extracted.
 */
export type EntityColumnValue<Column extends EntityColumn> = CoreEntityColumnValue<Column>;

/**
 * Extracts the legal operator union carried by an Entity column.
 *
 * @typeParam Column Entity column whose operator type is extracted.
 */
export type EntityColumnOperator<Column extends EntityColumn> = CoreEntityColumnOperator<Column>;

/**
 * Represents an immutable, nominal, descriptor-backed Entity column.
 *
 * @typeParam Schema Generated Protobuf schema that owns the column.
 * @typeParam Name Protobuf-ES property name for the column.
 * @typeParam Value Value stored in the column.
 * @typeParam Operator Operators accepted by the column.
 */
export type EntityColumn<
  Schema extends GenMessage<Message> = GenMessage<Message>,
  Name extends string = string,
  Value = unknown,
  Operator extends EntityOrderingOperator = EntityOrderingOperator,
> = CoreEntityColumnType<Schema, Name, Value, Operator>;

/**
 * Exposes the canonical Entity-column constructor through this compatibility package.
 */
export const EntityColumn: typeof CoreEntityColumn = CoreEntityColumn;

export { GeneratedEntityColumns };
