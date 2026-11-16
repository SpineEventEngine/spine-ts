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

import { clone, create, type Message, type MessageShape } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { Client, type ClientRequest } from "@spine-event-engine/client-node";
import { SignalEnvelopes } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  CommandSchema,
  EventContextSchema,
  EventSchema,
  UserIdSchema,
  type Command,
  type Event,
} from "@spine-event-engine/proto";
import {
  Application,
  Server,
  ServerEnvironment,
  SignalMetadata,
  type BoundedContext,
  type BoundedContextBuilder,
  type RunningServer,
} from "@spine-event-engine/server";
import { observeProducedSignals } from "@spine-event-engine/server/testing";
import { expect, vi } from "vitest";

/**
 * Runs public client calls beside direct Bounded Context assertions.
 */
export class ApplicationTestSession {
  readonly #commands: Command[] = [];

  readonly #events: Event[] = [];

  readonly #observation: { close(): void };

  private constructor(
    readonly context: BoundedContext,
    readonly application: Application,
    readonly endpoint: RunningServer,
    readonly client: ReturnType<typeof Client.connectTo>,
  ) {
    this.#observation = observeProducedSignals(context, {
      onCommand: (command) => this.#commands.push(clone(CommandSchema, command)),
      onEvent: (event) => this.#events.push(clone(EventSchema, event)),
    });
  }

  /**
   * Builds one test Application and native endpoint.
   *
   * @param builder Bounded Context declaration under test.
   * @returns Direct context and public client session.
   */
  static async open(builder: BoundedContextBuilder): Promise<ApplicationTestSession> {
    const environment = ServerEnvironment.newBuilder().build();
    const applicationBuilder = Application.newBuilder().setServerEnvironment(environment);
    let application: Application;
    try {
      application = await applicationBuilder.add(builder).build();
    } catch (error) {
      return ApplicationTestSession.closeAfterFailure(error, async () => {
        await applicationBuilder.close();
        await environment.close();
      });
    }
    let endpoint: RunningServer | undefined;
    let client: ReturnType<typeof Client.connectTo> | undefined;
    try {
      endpoint = await Server.atPort(0).setApplication(application).start();
      const context = application.contexts()[0];
      if (context === undefined) throw new Error("Expected a Bounded Context in the Application.");
      client = Client.connectTo(endpoint.baseUrl);
      return new ApplicationTestSession(context, application, endpoint, client);
    } catch (error) {
      return ApplicationTestSession.closeAcquired(error, application, endpoint, client);
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
      throw new AggregateError(
        [error, cleanup],
        "Application test session startup cleanup failed.",
      );
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
      throw new AggregateError(failures, "Application test session startup cleanup failed.");
    throw error;
  }

  /**
   * Opens a guest client scope.
   *
   * @returns A scope for generated Commands and queries.
   */
  asGuest(): ClientRequest {
    return this.client.asGuest();
  }

  /**
   * Lists produced Command envelopes.
   *
   * @returns Independent Command snapshots.
   */
  assertCommands(): readonly Command[] {
    return this.#commands.map((command) => clone(CommandSchema, command));
  }

  /**
   * Lists produced Event envelopes.
   *
   * @returns Independent Event snapshots.
   */
  assertEvents(): readonly Event[] {
    return this.#events.map((event) => clone(EventSchema, event));
  }

  /**
   * Waits for an observed test result using the existing BlackBox budget.
   *
   * @typeParam Value Current result type.
   * @param read Reads the current value.
   * @param ready Checks whether the result is ready.
   * @returns The first ready result.
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
   * Posts one domain Event directly to its Bounded Context.
   *
   * @typeParam Schema Domain Event schema.
   * @param schema Domain Event schema.
   * @param message Domain Event body.
   * @returns Completion after direct Event admission.
   */
  async postEvent<Schema extends GenMessage<Message>>(
    schema: Schema,
    message: MessageShape<Schema>,
  ): Promise<void> {
    const metadata = new SignalMetadata();
    await this.context.eventBus().post(
      SignalEnvelopes.event({
        context: create(EventContextSchema, {
          timestamp: metadata.timestamp(),
          origin: {
            case: "importContext",
            value: create(ActorContextSchema, {
              actor: create(UserIdSchema, { value: "guest" }),
              timestamp: metadata.timestamp(),
            }),
          },
        }),
        schema,
        message,
      }),
    );
  }

  /**
   * Closes the client and endpoint before Application facilities.
   *
   * @returns Completion after test resources close.
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
    if (failures.length > 0)
      throw new AggregateError(failures, "Application test session cleanup failed.");
  }
}
