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
  EntityQuery as CoreEntityQuery,
  EntityQueryBuilder as CoreEntityQueryBuilder,
  type EntityComparisonPredicate as CoreEntityComparisonPredicate,
  type EntityGroup as CoreEntityGroup,
  type EntityPredicate as CoreEntityPredicate,
  type EntityQueryBuilder as CoreEntityQueryBuilderType,
} from "@spine-event-engine/core";

import type { EntityColumn } from "../entity/entity-column.js";

/**
 * Represents one typed leaf comparison in an Entity query predicate.
 *
 * @typeParam Column Entity column compared by this predicate.
 */
export type EntityComparisonPredicate<Column extends EntityColumn = EntityColumn> =
  CoreEntityComparisonPredicate<Column>;

/**
 * Represents a nested conjunction or disjunction in an Entity query predicate.
 *
 * @typeParam Column Entity column used by the nested predicates.
 */
export type EntityGroup<Column extends EntityColumn = EntityColumn> = CoreEntityGroup<Column>;

/**
 * Represents a typed predicate accepted by the Entity query builder.
 *
 * @typeParam Column Entity column used by the predicate.
 */
export type EntityPredicate<Column extends EntityColumn = EntityColumn> =
  CoreEntityPredicate<Column>;

/**
 * Builds a typed Entity query for the frozen Spine wire contract.
 *
 * @typeParam Schema Generated Protobuf state schema read by the query.
 * @typeParam Columns Registered descriptor-backed columns for the schema.
 */
export type EntityQueryBuilder<
  Schema extends GenMessage<Message>,
  Columns extends Readonly<Record<string, EntityColumn<Schema>>>,
> = CoreEntityQueryBuilderType<Schema, Columns>;

/**
 * Exposes the canonical Entity query builder through this compatibility package.
 */
export const EntityQueryBuilder: typeof CoreEntityQueryBuilder = CoreEntityQueryBuilder;

/**
 * Exposes typed Entity query predicates and builders through this compatibility package.
 */
export const EntityQuery: typeof CoreEntityQuery = CoreEntityQuery;
