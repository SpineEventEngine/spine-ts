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
import { ClientProtocolError as WebClientProtocolError } from "@spine-event-engine/client-web";

/**
 * The same protocol-error constructor exported by `@spine-event-engine/client-web`.
 */
const ClientProtocolError: typeof WebClientProtocolError = WebClientProtocolError;

export {
  EntityColumn,
  type EntityColumnDefinition,
  type EntityColumnDefinitionEntry,
  type EntityColumnOperator,
  type EntityColumnValue,
  type EntityColumnValueKind,
  type EntityColumns,
  type EntityComparison,
  type EntityEqualityOperator,
  type EntityOrderingOperator,
} from "./entity/entity-column.js";
export {
  EntityQuery,
  EntityQueryBuilder,
  type EntityComparisonPredicate,
  type EntityGroup,
  type EntityPredicate,
} from "./query/entity-query.js";
export { Client } from "./client/node-client.js";
export { ClientProtocolError };

/**
 * Shared browser-safe client returned by each Node factory.
 */
export type ClientKernel = import("@spine-event-engine/client-web").Client;

/**
 * Shared operation options accepted by the returned kernel.
 */
export type ClientOperationOptions =
  import("@spine-event-engine/client-web").ClientOperationOptions;

/**
 * Shared client construction options accepted by Node factories.
 */
export type ClientOptions = import("@spine-event-engine/client-web").ClientOptions;

/**
 * Shared outcome of a posted command.
 */
export type ClientOutcome = import("@spine-event-engine/client-web").ClientOutcome;

/**
 * Shared actor-bound request scope returned by the kernel.
 */
export type ClientRequest = import("@spine-event-engine/client-web").ClientRequest;

/**
 * Shared injected transport contract; Node factories create it internally.
 */
export type ClientTransport = import("@spine-event-engine/client-web").ClientTransport;

/**
 * Shared manually activated subscription handle.
 */
export type Subscription = import("@spine-event-engine/client-web").Subscription;

/**
 * A raw wire update or authoritative entity recovery delivered to a subscription consumer.
 */
export type SubscriptionDelivery = import("@spine-event-engine/client-web").SubscriptionDelivery;

/**
 * A lifecycle notification emitted independently of subscription deliveries.
 */
export type SubscriptionLifecycle = import("@spine-event-engine/client-web").SubscriptionLifecycle;

/**
 * Explicit kind and recovery information for a shared subscription.
 */
export type CreateSubscriptionOptions =
  import("@spine-event-engine/client-web").CreateSubscriptionOptions;
