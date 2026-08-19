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

/**
 * Reads the settings used to run the To-Do app with several local processes.
 * Process count and Delivery shard count stay separate application decisions.
 */
export interface TodoMultiProcessSettings {
  // prettier-ignore

  /**
   *
   * The managed Coordinator listener host.
   */
  readonly host: string;

  /**
   *
   * The managed Coordinator listener port.
   */
  readonly port: number;

  /**
   *
   * The shared Datastore project identifier.
   */
  readonly projectId: string;

  /**
   *
   * The external Delivery server endpoint.
   */
  readonly deliveryServerUrl: string;

  /**
   *
   * The number of complete local application replicas.
   */
  readonly processCount: number;

  /**
   *
   * The application-selected number of Delivery shards.
   */
  readonly deliveryShardCount: number;
}

/**
 * Reads the managed executable configuration.
 *
 * @param environment Supplies the process settings.
 * @returns The validated managed deployment settings.
 */
export function readTodoMultiProcessSettings(
  environment: NodeJS.ProcessEnv,
): TodoMultiProcessSettings {
  return {
    host: required(environment, "HOST"),
    port: port(required(environment, "PORT")),
    projectId: required(environment, "DATASTORE_PROJECT_ID"),
    deliveryServerUrl: httpUrl(required(environment, "DELIVERY_SERVER_URL")),
    processCount: positiveSafeInteger(required(environment, "PROCESS_COUNT"), "PROCESS_COUNT"),
    deliveryShardCount: positiveSafeInteger(
      required(environment, "DELIVERY_SHARD_COUNT"),
      "DELIVERY_SHARD_COUNT",
    ),
  };
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0)
    throw new Error(`Missing required configuration: ${name}.`);
  return value;
}
function port(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535)
    throw new Error("Invalid required configuration: PORT.");
  return parsed;
}
function positiveSafeInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`Invalid required configuration: ${name}.`);
  return parsed;
}
function httpUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("Invalid required configuration: DELIVERY_SERVER_URL.");
  return url.toString().replace(/\/$/u, "");
}
