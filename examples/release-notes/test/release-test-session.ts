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
} from "@spine-event-engine/server";
import { observeProducedSignals } from "@spine-event-engine/server/testing";
import type { StorageFactory } from "@spine-event-engine/storage";
import { expect, vi } from "vitest";

/**
 * Keeps direct Bounded Context reads and public client requests in one test Application.
 */
export class ReleaseTestSession {
  readonly #events: Event[] = [];

  readonly #observation: { close(): void };

  private constructor(
    readonly context: BoundedContext,
    readonly application: Application,
    readonly endpoint: RunningServer,
    readonly client: ReturnType<typeof Client.connectTo>,
    readonly timeoutMs: number,
  ) {
    this.#observation = observeProducedSignals(context, {
      onEvent: (event) => this.#events.push(clone(EventSchema, event)),
    });
  }

  /**
   * Opens a fresh Application and public endpoint for one test.
   *
   * @param builder Release Notes Bounded Context declaration.
   * @param storageFactory Storage used by this test Application.
   * @param timeoutMs Existing eventual assertion timeout for the test.
   * @returns A session exposing its direct Bounded Context and public client.
   */
  static async open(
    builder: BoundedContextBuilder,
    storageFactory: StorageFactory,
    timeoutMs: number,
  ): Promise<ReleaseTestSession> {
    const environment = ServerEnvironment.newBuilder()
      .under(EnvironmentType.Local, (setting) => {
        setting.use({ storageFactory });
      })
      .build();
    const applicationBuilder = Application.newBuilder().setServerEnvironment(environment);
    let application: Application;
    try {
      application = await applicationBuilder.add(builder).build();
    } catch (error) {
      return ReleaseTestSession.closeAfterFailure(error, async () => {
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
      return new ReleaseTestSession(context, application, endpoint, client, timeoutMs);
    } catch (error) {
      return ReleaseTestSession.closeAcquired(error, application, endpoint, client);
    }
  }

  /**
   * Closes an acquired resource after test-session startup fails.
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
      throw new AggregateError([error, cleanup], "Release session startup cleanup failed.");
    }
    throw error;
  }

  /**
   * Closes acquired resources while retaining storage under a failed endpoint.
   *
   * @param error Startup failure.
   * @param application Built Application.
   * @param endpoint Started native endpoint, if any.
   * @param client Connected public client, if any.
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
      throw new AggregateError(failures, "Release session startup cleanup failed.");
    throw error;
  }

  /**
   * Returns the public guest request scope for this session.
   */
  asGuest() {
    return this.client.asGuest();
  }

  /**
   * Returns independent snapshots of Events emitted by the Bounded Context.
   */
  assertEvents(): readonly Event[] {
    return this.#events.map((event) => clone(EventSchema, event));
  }

  /**
   * Repeats a read until its condition holds within the test's existing timeout.
   *
   * @typeParam Value The value returned by the read.
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
      { timeout: this.timeoutMs },
    );
    return result;
  }

  /**
   * Closes the public client, endpoint, and Application in that order.
   *
   * @returns Completion after this test Application closes.
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
    if (failures.length > 0) throw new AggregateError(failures, "Release session cleanup failed.");
  }
}
