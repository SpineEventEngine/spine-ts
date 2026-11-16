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

import { clone } from "@bufbuild/protobuf";
import { Client } from "@spine-event-engine/client-node";
import { EventSchema, type Event } from "@spine-event-engine/proto";
import {
  Application,
  EnvironmentType,
  Server,
  ServerEnvironment,
  type BoundedContext,
  type BoundedContextBuilder,
  type RunningServer,
  type ServerEnvironmentSettings,
} from "@spine-event-engine/server";
import { observeProducedSignals } from "@spine-event-engine/server/testing";
import { expect, vi } from "vitest";

/**
 * Runs To-Do public-client requests beside direct Bounded Context assertions.
 */
export class TodoTestSession {
  readonly #events: Event[] = [];

  readonly #observation: { close(): void };

  private constructor(
    readonly context: BoundedContext,
    readonly application: Application,
    readonly endpoint: RunningServer,
    readonly client: ReturnType<typeof Client.connectTo>,
  ) {
    this.#observation = observeProducedSignals(context, {
      onEvent: (event) => this.#events.push(clone(EventSchema, event)),
    });
  }

  /**
   * Starts a fresh test Application and local endpoint.
   *
   * @param builder Tasks Bounded Context declaration.
   * @param settings Optional Application environment facilities.
   * @returns The public-client and direct-context test session.
   */
  static async open(
    builder: BoundedContextBuilder,
    settings: ServerEnvironmentSettings = {},
  ): Promise<TodoTestSession> {
    const environment = ServerEnvironment.newBuilder()
      .under(EnvironmentType.Local, (setting) => {
        setting.use(settings);
      })
      .build();
    const applicationBuilder = Application.newBuilder().setServerEnvironment(environment);
    let application: Application;
    try {
      application = await applicationBuilder.add(builder).build();
    } catch (error) {
      return TodoTestSession.closeAfterFailure(error, async () => {
        await applicationBuilder.close();
        await environment.close();
      });
    }
    let endpoint: RunningServer | undefined;
    let client: ReturnType<typeof Client.connectTo> | undefined;
    try {
      endpoint = await Server.atPort(0).setApplication(application).start();
      client = Client.connectTo(endpoint.baseUrl);
      const context = application.contexts()[0];
      if (context === undefined) throw new Error("Expected a Bounded Context in the Application.");
      return new TodoTestSession(context, application, endpoint, client);
    } catch (error) {
      return TodoTestSession.closeAcquired(error, application, endpoint, client);
    }
  }

  /**
   * Closes a resource acquired before test-session startup failed.
   *
   * @param error Startup failure.
   * @param close Resource cleanup.
   * @returns Never, because startup failed.
   */
  private static async closeAfterFailure(
    error: unknown,
    close: () => Promise<void>,
  ): Promise<never> {
    try {
      await close();
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], "To-Do session startup cleanup failed.");
    }
    throw error;
  }

  /**
   * Closes acquired test-session resources in listener-safe order.
   *
   * @param error Startup failure.
   * @param application Built test Application.
   * @param endpoint Native endpoint, if started.
   * @param client Public client, if connected.
   * @returns Never, because startup failed.
   */
  private static async closeAcquired(
    error: unknown,
    application: Application,
    endpoint: RunningServer | undefined,
    client: ReturnType<typeof Client.connectTo> | undefined,
  ): Promise<never> {
    const failures: unknown[] = [error];
    try {
      await client?.close();
    } catch (cleanup) {
      failures.push(cleanup);
    }
    let endpointClosed = endpoint === undefined;
    try {
      await endpoint?.close();
      endpointClosed = true;
    } catch (cleanup) {
      failures.push(cleanup);
    }
    if (endpointClosed) {
      try {
        await application.close();
      } catch (cleanup) {
        failures.push(cleanup);
      }
    }
    if (failures.length > 1)
      throw new AggregateError(failures, "To-Do session startup cleanup failed.");
    throw error;
  }

  /**
   * Starts a public guest request scope.
   *
   * @returns The guest request scope.
   */
  asGuest() {
    return this.client.asGuest();
  }

  /**
   * Returns independent snapshots of produced Events.
   *
   * @returns Events observed from this Bounded Context.
   */
  assertEvents(): readonly Event[] {
    return this.#events.map((event) => clone(EventSchema, event));
  }

  /**
   * Repeats a read within the existing To-Do BlackBox timeout.
   *
   * @typeParam Value Result of each read.
   * @param read Current test observation.
   * @param ready Predicate defining the expected state.
   * @returns The first value satisfying the predicate.
   */
  async eventually<Value>(
    read: () => Value | Promise<Value>,
    ready: (value: Value) => boolean,
  ): Promise<Value> {
    let result!: Value;
    await vi.waitFor(
      async () => {
        result = await read();
        expect(ready(result)).toBe(true);
      },
      { timeout: 500, interval: 5 },
    );
    return result;
  }

  /**
   * Stops the client and endpoint before closing the Application.
   *
   * @returns Completion after all test resources close.
   */
  async close(): Promise<void> {
    const failures: unknown[] = [];
    try {
      await this.client.close();
    } catch (error) {
      failures.push(error);
    }
    let endpointClosed = false;
    try {
      await this.endpoint.close();
      endpointClosed = true;
    } catch (error) {
      failures.push(error);
    }
    try {
      this.#observation.close();
    } catch (error) {
      failures.push(error);
    }
    if (endpointClosed) {
      try {
        await this.application.close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, "To-Do session cleanup failed.");
  }
}
