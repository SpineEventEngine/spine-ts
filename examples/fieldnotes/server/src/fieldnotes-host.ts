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

import { randomUUID } from "node:crypto";
import {
  OpaqueSessionCookies,
  OpaqueSessions,
  PersistentOpaqueSessionStore,
} from "@spine-event-engine/auth";
import { StringifierRegistry, Time, TypeRegistry } from "@spine-event-engine/core";
import { fieldnotesProtoModule } from "@spine-event-engine/example-fieldnotes-model";
import {
  Environment,
  Server,
  ServerEnvironment,
  type RunningServer,
} from "@spine-event-engine/server";
import { BrowserServer, DurableSubscriptionBindings } from "@spine-event-engine/server/browser";
import { StorageGroup, type StorageFactory } from "@spine-event-engine/storage";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";
import {
  FieldnotesAccess,
  FieldnotesClock,
  FieldnotesContextResolver,
} from "./fieldnotes-access.js";
import { createFieldnotesContext } from "./place-domain.js";
import { fieldnotesReadFilters } from "./fieldnotes-read-filters.js";
import { FieldnotesReaderProof } from "./reader-proof.js";
import type { FieldnotesSettings } from "./host-settings.js";
import "../generated/spine-bootstrap.js";

/**
 * Selects an explicit storage factory only for isolated host tests.
 */
export interface FieldnotesHostOptions {
  /**
   * Storage used instead of the default PostgreSQL deployment factory.
   */
  readonly storageFactory?: StorageFactory;
}

/**
 * Runs one private native server and one authenticated browser gateway.
 */
export class FieldnotesHost {
  readonly #factory: StorageFactory;

  #environment: ServerEnvironment | undefined;

  #sessionStore: PersistentOpaqueSessionStore | undefined;

  #bindings: DurableSubscriptionBindings | undefined;

  #proof: FieldnotesReaderProof | undefined;

  #native: RunningServer | undefined;

  #sessions: OpaqueSessions | undefined;

  #cookies: OpaqueSessionCookies | undefined;

  #gateway: RunningServer | undefined;

  /**
   * Returns the shared app-session strategy used by gateway and auth routes.
   *
   * @returns Persistent session strategy for this host.
   */
  get sessions(): OpaqueSessions {
    if (this.#sessions === undefined) throw new Error("Fieldnotes sessions are unavailable.");
    return this.#sessions;
  }

  /**
   * Returns the strict Secure cookie and CSRF helper.
   *
   * @returns Cookie policy for this host.
   */
  get cookies(): OpaqueSessionCookies {
    if (this.#cookies === undefined) throw new Error("Fieldnotes cookies are unavailable.");
    return this.#cookies;
  }

  /**
   * Returns the authenticated browser listener for the same-origin proxy.
   *
   * @returns Running browser listener.
   */
  get gateway(): RunningServer {
    if (this.#gateway === undefined) throw new Error("Fieldnotes gateway is unavailable.");
    return this.#gateway;
  }

  /**
   * Returns the loopback-only native service listener.
   *
   * @returns Running native listener, if startup reached it.
   */
  get native(): RunningServer | undefined {
    return this.#native;
  }

  /**
   * Records the factory until the explicit host lifecycle closes it.
   *
   * @param factory Selected single-tenant storage provider.
   */
  private constructor(factory: StorageFactory) {
    this.#factory = factory;
  }

  /**
   * Starts one host with PostgreSQL by default and explicit test storage when supplied.
   *
   * @param settings Required deployment and session policy.
   * @param options Explicit isolated-test storage selection.
   * @returns Running authenticated Fieldnotes host.
   */
  static async open(
    settings: FieldnotesSettings,
    options: FieldnotesHostOptions = {},
  ): Promise<FieldnotesHost> {
    const factory = options.storageFactory ?? (await this.postgres(settings.postgresUrl));
    const host = new FieldnotesHost(factory);
    try {
      await host.start(settings);
      return host;
    } catch (error) {
      try {
        await host.close();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], "Fieldnotes host startup and cleanup failed.");
      }
      throw error;
    }
  }

  /**
   * Builds the sole deployment database factory and its generated ID stringifiers.
   *
   * @param url Provisioned PostgreSQL database URL.
   * @returns Open single-tenant storage factory.
   */
  private static postgres(url: string): Promise<PostgresStorageFactory> {
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(TypeRegistry.from(fieldnotesProtoModule));
    return PostgresStorageFactory.newBuilder()
      .setOptions({ url })
      .setStringifierRegistry(stringifiers)
      .build();
  }

  /**
   * Acquires persistent admission, domain, native listener and browser listener in order.
   *
   * @param settings Required deployment settings.
   * @returns Completion after all listeners start.
   */
  private async start(settings: FieldnotesSettings): Promise<void> {
    const registry = TypeRegistry.from(fieldnotesProtoModule);
    ServerEnvironment.when(Environment.instance().type).use({
      storageFactory: this.#factory,
      typeRegistry: registry,
    });
    this.#environment = ServerEnvironment.instance();
    await this.#environment.completeSetup();
    this.#sessionStore = await PersistentOpaqueSessionStore.create({
      storageFactory: this.#factory,
      group: new StorageGroup("fieldnotes-sessions"),
    });
    const clock = new FieldnotesClock();
    this.#sessions = await OpaqueSessions.create({
      store: this.#sessionStore,
      scope: "fieldnotes",
      password: settings.sessionPassword,
      clock: { now: () => Time.currentTimeMillis() },
      ttlMilliseconds: settings.sessionTtlMilliseconds,
    });
    this.#cookies = new OpaqueSessionCookies({
      csrfSecret: settings.csrfSecret,
      origins: [settings.publicOrigin],
      persistent: true,
    });
    this.#proof = new FieldnotesReaderProof(settings.readerProofSecret);
    await this.openListeners(registry, clock, settings.publicOrigin);
  }

  /**
   * Starts a loopback native boundary followed by the authenticated browser gateway.
   *
   * @param registry Generated domain schema lookup.
   * @param clock Trusted gateway clock.
   * @param publicOrigin Exact browser origin.
   * @returns Completion after the gateway starts.
   */
  private async openListeners(
    registry: TypeRegistry,
    clock: FieldnotesClock,
    publicOrigin: string,
  ): Promise<void> {
    const context = await createFieldnotesContext();
    const proof = this.#proof;
    if (proof === undefined) throw new Error("Reader proof is unavailable.");
    this.#bindings = new DurableSubscriptionBindings({
      storageFactory: this.#factory,
      namespace: "fieldnotes",
      nextId: randomUUID,
      cleanup: () => Promise.resolve(),
    });
    this.#native = await new Server({
      host: "127.0.0.1",
      port: 0,
      contexts: [context],
      readSideFilters: fieldnotesReadFilters(),
      services: { readerAdmission: { forwarded: proof } },
    }).start();
    await this.openGateway(registry, clock, publicOrigin, proof);
  }

  /**
   * Opens the browser listener against the already running native listener.
   *
   * @param registry Generated domain schema lookup.
   * @param clock Trusted gateway clock.
   * @param publicOrigin Exact browser origin.
   * @param proof Shared native reader proof adapter.
   * @returns Completion after browser admission starts.
   */
  private async openGateway(
    registry: TypeRegistry,
    clock: FieldnotesClock,
    publicOrigin: string,
    proof: FieldnotesReaderProof,
  ): Promise<void> {
    const policy = new FieldnotesAccess();
    const native = this.#native;
    if (native === undefined) throw new Error("Native listener is unavailable.");
    const bindings = this.#bindings;
    if (bindings === undefined) throw new Error("Subscription bindings are unavailable.");
    this.#gateway = await BrowserServer.open(native, {
      host: "127.0.0.1",
      port: 0,
      origins: [publicOrigin],
      registry,
      sessions: this.sessions,
      cookies: this.cookies,
      bindings,
      forwardingProof: proof,
      authorize: policy.authorize.bind(policy),
      contexts: new FieldnotesContextResolver(),
      clock,
    });
  }

  /**
   * Stops admission and streams before closing sessions, stores and environment.
   *
   * @returns Completion or combined cleanup failures.
   */
  async close(): Promise<void> {
    const failures: unknown[] = [];
    for (const release of [
      () => this.#gateway?.close(),
      () => this.#native?.close(),
      () => this.#bindings?.close(),
      () => this.#sessions?.close(),
      () => this.#sessionStore?.close(),
      () => this.#cookies?.close(),
      () => this.#proof?.close(),
      () => this.#environment?.close() ?? this.#factory.close(),
    ]) {
      try {
        await release();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, "Fieldnotes host close failed.");
  }
}
