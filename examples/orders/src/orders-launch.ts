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
 * Supplies asynchronous closure for an Orders launch resource.
 */
export interface OrdersLaunchResource {
  /**
   * Closes this resource after admitted work drains.
   *
   * @returns Completion after the resource closes.
   */
  close(): Promise<void>;
}

/**
 * Starts an Orders server and closes its resources in dependency order.
 *
 * @typeParam S The running server supplied to the scenario.
 * @typeParam T The scenario result.
 * @param setup The configured environment and tenant index.
 * @param start Starts the server after the environment is configured.
 * @param run Executes the scenario using the running server.
 * @returns The scenario result after the server and setup close.
 */
export async function withOrdersServer<S extends OrdersLaunchResource, T>(
  setup: OrdersLaunchResource,
  start: () => Promise<S>,
  run: (server: S) => Promise<T>,
): Promise<T> {
  let server: S | undefined;
  let result!: T;
  let failed = false;
  let cause: unknown;
  try {
    server = await start();
    result = await run(server);
  } catch (error) {
    failed = true;
    cause = error;
  }
  if (server !== undefined)
    try {
      await server.close();
    } catch (error) {
      throw failed ? new AggregateError([cause, error], "Orders run and drain failed.") : error;
    }
  try {
    await setup.close();
  } catch (error) {
    throw failed ? new AggregateError([cause, error], "Orders run and setup close failed.") : error;
  }
  if (failed) throw cause;
  return result;
}
