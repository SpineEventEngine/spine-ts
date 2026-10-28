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

import { InMemoryStorageFactory, type StorageFactory } from "@spine-event-engine/storage";
import type { TenantId } from "@spine-event-engine/proto";
import { TenantBoundary, type StoragePreparationMode } from "@spine-event-engine/storage/provider";
import { LogLayer, StructuredTransport, type ILogLayer } from "loglayer";
import { InMemoryTransportFactory, type TransportFactory } from "@spine-event-engine/transport";
import { spineCoreRegistry, type TypeRegistryLookup } from "@spine-event-engine/core";

import { CloseErrors, RetryableCloseGroup } from "./retryable-close.js";
import { Delivery as CoreDelivery } from "../delivery/delivery.js";
import { deliveryControls, deliveryStrategyAccess } from "../delivery/delivery-builder.js";
import { DeliverySupervisor, deliverySupervisorAccess } from "../delivery/delivery-supervisor.js";
import type { InboxMessage } from "../delivery/inbox.js";
import { deliveryTenant } from "../delivery/delivery-tenant.js";
import type { Delivery as PublicDelivery, DeliveryStrategy } from "../delivery/delivery-builder.js";
import { emitServerInfo, emitServerWarning } from "./server-log.js";
import { managedDeliveryGate } from "./managed-delivery-gate.js";
import { boundedContextAccess, type BoundedContext } from "../context/bounded-context.js";
import { TenantIndexes, type TenantIndex } from "../context/tenant-index.js";
import { TenantUnknownError } from "../context/tenant-unknown-error.js";
import type { EnvironmentDeliveryPorts } from "../context/local-inbox-handoff.js";
import type { DeliveryInbox, DeliveryWorkRegistry } from "../delivery/delivery-ports.js";
import type { DeliverySource } from "../delivery/delivery-supervisor.js";
import { Environment, EnvironmentTests, EnvironmentType } from "./environment.js";

/**
 * Common closeable facility owned by a server environment.
 */
export interface ServerEnvironmentCloseable {
  // prettier-ignore

  /**
   * Closes the facility.
   *
   * @returns An optional asynchronous close operation.
   */
  close(): unknown;
}

/**
 * A closeable environment facility that opens before shared Delivery setup.
 */
export interface ServerEnvironmentDelivery extends ServerEnvironmentCloseable {
  // prettier-ignore

  /**
   * Opens the facility before the environment starts shared Delivery.
   *
   * @returns An optional asynchronous open operation.
   */
  open(): unknown;

  /**
   * Supplies the Inbox port used by shared environment Delivery.
   */
  readonly inbox: DeliveryInbox;

  /**
   * Supplies the shard work-registry port used by shared environment Delivery.
   */
  readonly workRegistry: DeliveryWorkRegistry;

  /**
   * Supplies the remote Admin source used to recover and observe shard work.
   */
  readonly source?: DeliverySource;
}

/**
 * Facilities configured for one Node environment type.
 */
export interface ServerEnvironmentSettings {
  // prettier-ignore

  /**
   * Live default membership index for Bounded Contexts.
   */
  readonly tenantIndex?: TenantIndex;

  /**
   * Storage facility selected for server assembly, including server-added context builders.
   */
  readonly storageFactory?: StorageFactory;

  /**
   * Optional message-channel factory for private bounded-context integration brokers.
   *
   * When omitted, this environment owns one `InMemoryTransportFactory` shared
   * by every local broker in the process and closes it once with the environment.
   */
  readonly integrationChannelFactory?: TransportFactory;

  /**
   * Complete generated application schema lookup used for ThirdParty event encoding.
   * Production requires it; local/test environments fall back to `spineCoreRegistry` only.
   */
  readonly typeRegistry?: TypeRegistryLookup;

  /**
   * Optional closeable Delivery port facility supplied during environment setup.
   * A remote facility may also provide `open`, `inbox`, `workRegistry`, and `source`.
   * The environment constructs its shared public Delivery separately.
   */
  readonly delivery?: ServerEnvironmentCloseable;

  /**
   * Maps targets to shards for every context in this environment.
   */
  readonly deliveryStrategy?: DeliveryStrategy;

  /**
   * Optional tracing factory placeholder for later tracing adapters.
   */
  readonly tracerFactory?: ServerEnvironmentCloseable;

  /**
   * Application-owned logger used by this environment and its attached runtime parts.
   * The caller retains transport flush and close ownership.
   */
  readonly logger?: ILogLayer;
}

/**
 * Creates facilities for the selected server environment.
 *
 * @returns The facilities selected for the environment.
 */
export type ServerEnvironmentSettingsFactory = () => ServerEnvironmentSettings;
type SettingsInput = ServerEnvironmentSettings | ServerEnvironmentSettingsFactory;
const configuredSettings = new Map<EnvironmentType, SettingsInput>();
let resolvedEnvironment: ServerEnvironment | undefined;
let resetInProgress: Promise<void> | undefined;

/**
 * Process-wide server facilities for the canonical {@link Environment}.
 */
export class ServerEnvironment implements ServerEnvironmentCloseable {
  // prettier-ignore

  /**
   * The environment whose settings resolved these facilities.
   */
  readonly environment: Environment;

  /**
   * Stable identity shared by every server in this singleton lifecycle.
   */
  readonly nodeId: string;

  /**
   * Storage facility selected for server assembly, including server-added context builders.
   */
  readonly storageFactory: StorageFactory;

  /**
   * Live default tenant membership index.
   */
  readonly tenantIndex: TenantIndex;

  /**
   * Message-channel factory selected for private bounded-context integration.
   *
   * This is either the configured override or one environment-owned
   * `InMemoryTransportFactory` shared by every local broker in the process and
   * closed once with the environment.
   */
  readonly integrationChannelFactory: TransportFactory;

  /**
   * Read-only application schema lookup used by private integration boundaries.
   */
  readonly typeRegistry: TypeRegistryLookup;

  /**
   * Optional closeable remote delivery facility selected for this environment.
   */
  readonly #remoteDelivery: ServerEnvironmentCloseable | undefined;

  /**
   * Returns the actual shared Delivery after explicit environment setup.
   * @returns The one public Delivery facade for this environment.
   */
  get delivery(): PublicDelivery {
    if (this.#publicDelivery === undefined)
      throw new Error("ServerEnvironment.completeSetup() must finish before Delivery use.");
    return this.#publicDelivery;
  }

  /**
   * Optional tracing factory selected for this environment.
   */
  readonly tracerFactory: ServerEnvironmentCloseable | undefined;

  readonly #ownedCloseables: readonly unknown[];

  readonly #closeGroup: RetryableCloseGroup;

  readonly #deliveryCloseGroup: RetryableCloseGroup;

  readonly #deliveryStrategy: DeliveryStrategy | undefined;

  #delivery: CoreDelivery | undefined;

  #publicDelivery: PublicDelivery | undefined;

  #supervisor: DeliverySupervisor | undefined;

  #supervisorStart: Promise<void> | undefined;

  #close: Promise<void> | undefined;

  #deliveryOpen: Promise<void> | undefined;

  #deliveryOpened = false;

  #closing = false;

  #fatal:
    | {
        readonly originals: unknown[];
        readonly cleanupErrors: unknown[];
        readonly cleanup: Promise<void>;
      }
    | undefined;

  /**
   * Initializes resolved environment facilities.
   *
   * @param environment Selected process environment.
   * @param settings Resolved facilities and settings.
   */
  private constructor(environment: Environment, settings: RequiredFacilities) {
    this.environment = environment;
    this.nodeId = crypto.randomUUID();
    this.storageFactory = settings.storageFactory;
    this.tenantIndex = settings.tenantIndex ?? TenantIndexes.fromFactory(settings.storageFactory);
    this.integrationChannelFactory = settings.integrationChannelFactory;
    this.typeRegistry = settings.typeRegistry;
    this.#remoteDelivery = settings.delivery;
    this.#deliveryStrategy = settings.deliveryStrategy;
    this.tracerFactory = settings.tracerFactory;
    this.#registerRuntimeHooks(settings.logger);
    this.#deliveryCloseGroup = new RetryableCloseGroup(
      [
        { close: () => this.#supervisor?.close() },
        { close: () => this.#delivery?.close() },
        this.#remoteDelivery,
      ],
      "Environment Delivery close failed.",
    );
    this.#ownedCloseables = ServerEnvironmentValues.facilitiesToClose(
      settings,
      this.#deliveryCloseGroup,
    );
    this.#closeGroup = new RetryableCloseGroup(
      this.#ownedCloseables,
      "ServerEnvironment close failed.",
    );
    Object.freeze(this);
  }

  /**
   * Registers package-local callbacks for this environment's runtime.
   * @param logger Receives diagnostics from these callbacks.
   */
  #registerRuntimeHooks(logger: ILogLayer): void {
    environmentLoggers.set(this, logger);
    environmentContexts.set(this, new EnvironmentContextRegistrations());
    startupControls.set(this, {
      fail: (cause) => {
        this.#failStartup(cause);
      },
      awaitFailure: () => this.#awaitStartupFailure(),
      available: () => {
        if (this.#closing) throw new Error("ServerEnvironment is closed.");
      },
      failed: () => this.#fatal !== undefined,
      recordCleanup: (error) => {
        if (this.#fatal !== undefined) CloseErrors.collect(error, this.#fatal.cleanupErrors);
      },
    });
    warnedVolatileRegistries.set(this, new WeakSet());
    supervisorStarters.set(this, () => this.#startSupervisor());
    deliveryNotifiers.set(this, (shard) => {
      this.#notifyDelivery(shard);
    });
    deliveryIdlers.set(this, () => this.#whenDeliveryIdle());
  }

  /**
   * Sets facilities for an environment type before first resolution.
   *
   * @param type Identifies the environment to configure.
   * @returns A one-use configuration entry point.
   */
  static when(type: EnvironmentType): { use(settings: SettingsInput): void } {
    return Object.freeze({
      use(settings: SettingsInput) {
        if (resetInProgress !== undefined) {
          throw new Error("ServerEnvironment reset is in progress.");
        }
        if (resolvedEnvironment !== undefined) {
          throw new Error("ServerEnvironment is already resolved and cannot be reconfigured.");
        }
        configuredSettings.set(type, settings);
      },
    });
  }

  /**
   * Resolves this module graph's configured server facilities exactly once.
   *
   * @returns The process-wide server environment.
   */
  static instance(): ServerEnvironment {
    if (resetInProgress !== undefined) {
      throw new Error("ServerEnvironment reset is in progress.");
    }
    return (resolvedEnvironment ??= this.#resolve());
  }

  static #resolve(): ServerEnvironment {
    const environment = Environment.instance();
    const configured = configuredSettings.get(environment.type);
    const settings = typeof configured === "function" ? configured() : configured;
    const facilities = ServerEnvironmentValues.resolveFacilities(environment.type, settings ?? {});
    return new ServerEnvironment(environment, facilities);
  }

  /**
   * Checks shared storage and initializes transport and Delivery before context startup.
   *
   * @returns The coalesced setup attempt for this environment lifetime.
   */
  completeSetup(): Promise<void> {
    if (this.#closing) return Promise.reject(new Error("ServerEnvironment is closed."));
    const current = environmentSetups.get(this);
    if (current !== undefined) return current;
    const started = this.#completeSetup();
    environmentSetups.set(this, started);
    return started;
  }

  /**
   * Creates declared structures for the completed open contexts in this environment.
   * Explicit IDs select matching multitenant contexts through their effective indexes.
   * Database-backed providers require an existing database; this method does not
   * provision one or register tenants.
   * @param tenantIds Optional complete tenant identities; absence includes single-tenant
   * contexts and pages current multitenant indexes.
   * @returns Completion after participating contexts are prepared.
   */
  createStorageStructures(...tenantIds: TenantId[]): Promise<void> {
    return this.#prepareContexts("create", tenantIds);
  }

  /**
   * Checks existing structures without authorizing creation.
   * Explicit IDs select matching multitenant contexts through their effective indexes.
   * The operation does not provision databases or register tenants.
   * @param tenantIds Optional complete tenant identities; absence includes single-tenant
   * contexts and pages current multitenant indexes.
   * @returns Completion after participating contexts pass read-only checks.
   */
  checkStructureCompatibility(...tenantIds: TenantId[]): Promise<void> {
    return this.#prepareContexts("check", tenantIds);
  }

  /**
   * Prevalidates selected tenant membership before starting provider work.
   * @param contexts Captured completed context references.
   * @param tenantIds Explicit complete tenant identities.
   * @returns Participating contexts and their selected tenants.
   */
  async #selectedContexts(
    contexts: readonly BoundedContext[],
    tenantIds: readonly TenantId[],
  ): Promise<Map<BoundedContext, TenantId[]>> {
    const selected = new Map<BoundedContext, TenantId[]>();
    const boundaries = new Map<string | symbol, ReturnType<typeof TenantBoundary.from>>();
    for (const id of tenantIds) {
      const boundary = TenantBoundary.from(id);
      boundaries.set(boundary.key, boundary);
    }
    for (const boundary of boundaries.values()) {
      let found = false;
      for (const context of contexts) {
        serverEnvironmentAccess.requireAvailable(this);
        if (!context.isMultitenant) continue;
        const present = await context.tenantIndex.contains(boundary.tenantId);
        serverEnvironmentAccess.requireAvailable(this);
        if (!present) continue;
        const ids = selected.get(context) ?? [];
        ids.push(boundary.tenantId);
        selected.set(context, ids);
        found = true;
      }
      if (!found) throw new TenantUnknownError(boundary.tenantId, "ServerEnvironment");
    }
    return selected;
  }

  /**
   * Prepares captured contexts after complete explicit-ID validation.
   * @param mode Creation or read-only check.
   * @param tenantIds Optional complete tenant identities.
   * @returns Completion after every participating context settles.
   */
  async #prepareContexts(
    mode: StoragePreparationMode,
    tenantIds: readonly TenantId[],
  ): Promise<void> {
    serverEnvironmentAccess.requireAvailable(this);
    const captured = tenantIds.map((id) => TenantBoundary.from(id).tenantId);
    const contexts = serverEnvironmentAccess
      .openContexts(this)
      .filter((context) => !boundedContextAccess.isClosing(context));
    if (contexts.length === 0)
      throw new Error("ServerEnvironment has no completed Bounded Context to prepare.");
    const selection = Promise.withResolvers<Map<BoundedContext, TenantId[]> | undefined>();
    const admitted = contexts.map((context) =>
      boundedContextAccess.admitServiceRegistryOperation(context, async () => {
        const selected = await selection.promise;
        const ids = selected?.get(context);
        if (selected !== undefined && ids === undefined) return;
        await boundedContextAccess.prepareExplicit(context, mode, ids ?? []);
      }),
    );
    if (captured.length === 0) selection.resolve(undefined);
    else void this.#selectedContexts(contexts, captured).then(selection.resolve, selection.reject);
    const results = await Promise.allSettled(admitted);
    if (serverEnvironmentAccess.hasStartupFailure(this))
      return serverEnvironmentAccess.awaitStartupFailure(this);
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }

  async #completeSetup(): Promise<void> {
    try {
      if (typeof this.integrationChannelFactory.initialize !== "function")
        throw new TypeError("TransportFactory.initialize is required.");
      await this.storageFactory.checkConnection();
      emitServerInfo(
        ServerEnvironmentValues.loggerFor(this),
        "Environment storage connection checked.",
        { operation: "server.setup_storage" },
      );
      await this.integrationChannelFactory.initialize();
      emitServerInfo(
        ServerEnvironmentValues.loggerFor(this),
        "Environment transport initialized.",
        { operation: "server.setup_transport" },
      );
      await this.#openDelivery();
      if (this.#closing) throw new Error("ServerEnvironment closed during setup.");
      emitServerInfo(ServerEnvironmentValues.loggerFor(this), "Environment Delivery initialized.", {
        operation: "server.setup_delivery",
      });
    } catch (error) {
      this.#closing = true;
      const cleanup = await Promise.allSettled([this.#closeGroup.close()]);
      const failures = cleanup.flatMap((result) => {
        if (result.status !== "rejected") return [];
        return result.reason instanceof AggregateError
          ? (result.reason.errors as unknown[])
          : [result.reason as unknown];
      });
      if (failures.length)
        throw new AggregateError([error, ...failures], "Environment setup failed.");
      throw error;
    }
  }

  /**
   * Closes this environment after all Bounded Contexts close.
   *
   * A healthy environment with active contexts rejects without teardown. After
   * required startup failure, this joins automatic cleanup and rejects with the
   * original cause and any cleanup failures. Successful closure prevents reuse;
   * failed facility closes during an ordinary close remain retryable.
   *
   * @returns Completion after facilities close or a rejection reporting failures.
   */
  close(): Promise<void> {
    if (this.#fatal !== undefined) return this.#awaitStartupFailure();
    if (EnvironmentContextRegistrations.forEnvironment(this).active)
      return Promise.reject(
        new Error("Cannot close ServerEnvironment with active Bounded Contexts."),
      );
    this.#closing = true;
    this.#delivery?.beginClose();
    this.#close ??= Promise.resolve()
      .then(async () => {
        const setup = environmentSetups.get(this);
        if (setup !== undefined) await Promise.allSettled([setup]);
      })
      .then(() => this.#closeGroup.close())
      .catch((error: unknown) => {
        this.#close = undefined;
        throw error;
      });
    return this.#close;
  }

  /**
   * Fences a failed required startup phase and starts one automatic cleanup.
   * @param cause Original required-phase failure.
   */
  #failStartup(cause: unknown): void {
    if (this.#fatal !== undefined) {
      this.#fatal.originals.push(cause);
      return;
    }
    this.#closing = true;
    const contexts = EnvironmentContextRegistrations.forEnvironment(this);
    const cleanupErrors: unknown[] = [];
    const cleanup = Promise.resolve().then(() => this.#cleanupStartup(contexts, cleanupErrors));
    this.#fatal = { originals: [cause], cleanupErrors, cleanup };
    for (const context of contexts.allContexts()) {
      try {
        boundedContextAccess.beginClose(context);
      } catch (error) {
        CloseErrors.collect(error, cleanupErrors);
      }
    }
    this.#delivery?.beginStartupDrain();
  }

  /**
   * Waits for local rollbacks, then closes contexts and shared facilities.
   * @param contexts Context registrations for this environment.
   * @param cleanupErrors Mutable cleanup failures.
   * @returns Completion after every cleanup attempt.
   */
  async #cleanupStartup(
    contexts: EnvironmentContextRegistrations,
    cleanupErrors: unknown[],
  ): Promise<void> {
    const started = new Set(contexts.openContexts());
    const observe = (context: BoundedContext): Promise<PromiseSettledResult<void>> =>
      Promise.resolve()
        .then(() => context.close())
        .then(
          (): PromiseFulfilledResult<void> => ({ status: "fulfilled", value: undefined }),
          (reason: unknown): PromiseRejectedResult => ({ status: "rejected", reason }),
        );
    const completed = [...started].map(observe);
    await contexts.whenBuildsIdle();
    const remaining = contexts
      .allContexts()
      .filter((context) => !started.has(context))
      .map(observe);
    for (const result of await Promise.all([...completed, ...remaining]))
      if (result.status === "rejected") CloseErrors.collect(result.reason, cleanupErrors);
    this.#delivery?.beginClose();
    try {
      await this.#closeGroup.close();
    } catch (error) {
      CloseErrors.collect(error, cleanupErrors);
    }
  }

  /**
   * Reports all original and cleanup errors after automatic cleanup settles.
   * @returns Rejection preserving the original failure when it is the only error.
   */
  async #awaitStartupFailure(): Promise<never> {
    const fatal = this.#fatal;
    if (fatal === undefined) throw new Error("No startup failure was recorded.");
    await fatal.cleanup;
    const failures = [...fatal.originals, ...fatal.cleanupErrors];
    if (failures.length === 1) throw failures[0];
    throw new AggregateError(failures, "Required environment initialization failed.");
  }

  #openDelivery(): Promise<void> {
    if (this.#deliveryOpened) return Promise.resolve();
    const opening = (this.#deliveryOpen ??= Promise.resolve()
      .then(async () => {
        const remote = ServerEnvironmentValues.openableDelivery(this.#remoteDelivery);
        if (remote !== undefined) await remote.open();
        if (this.#closing) throw new Error("ServerEnvironment closed during Delivery setup.");
        this.#constructDelivery(ServerEnvironmentValues.ports(this.#remoteDelivery));
      })
      .then(() => {
        this.#deliveryOpened = true;
      }));
    // spine-log-boundary: server.delivery_open_reset
    void opening.catch(() => {
      if (this.#deliveryOpen === opening) this.#deliveryOpen = undefined;
    });
    return opening;
  }

  /**
   * Constructs the one environment Delivery after configured ports open.
   * @param ports Open remote ports when configured.
   */
  #constructDelivery(ports?: EnvironmentDeliveryPorts): void {
    const delivery = new CoreDelivery({
      context: { name: "__System_Delivery__", multitenant: false },
      storageFactory: this.storageFactory,
      node: this.nodeId,
      ...(this.#deliveryStrategy === undefined
        ? {}
        : { strategy: deliveryStrategyAccess.snapshot(this.#deliveryStrategy) }),
      ...(ports ?? {}),
    });
    delivery.setReplay(
      (message) => this.#replayMessage(message),
      (message) => this.#acceptsMessage(message),
    );
    this.#delivery = delivery;
    environmentDeliveryCores.set(this, delivery);
    this.#publicDelivery = deliveryControls.supervised(delivery);
    if (ports?.source !== undefined) this.#installSupervisor(this.#publicDelivery, ports.source);
  }

  #acceptsMessage(message: InboxMessage): boolean {
    return (
      EnvironmentContextRegistrations.forEnvironment(this).recipient(
        message.inboxId.targetTypeUrl,
      ) !== undefined
    );
  }

  #installSupervisor(delivery: PublicDelivery, source: DeliverySource): void {
    const supervisor = new DeliverySupervisor({
      source,
      delivery,
      onMessage: (message) => this.#replayMessage(message),
    });
    deliverySupervisorAccess.installAdmission(supervisor, (message) =>
      this.#acceptsMessage(message),
    );
    deliverySupervisorAccess.installLogger(supervisor, ServerEnvironmentValues.loggerFor(this));
    this.#supervisor = supervisor;
    remoteSupervisedEnvironments.add(this);
  }

  #startSupervisor(): Promise<void> {
    const supervisor = this.#supervisor;
    return supervisor === undefined
      ? Promise.resolve()
      : managedDeliveryGate.start(() => (this.#supervisorStart ??= supervisor.start()));
  }

  #notifyDelivery(shard: import("../delivery/shard-index.js").ShardIndex): void {
    if (this.#supervisor === undefined) {
      this.#delivery?.wake(shard);
      return;
    }
    try {
      this.#supervisor.notify(shard);
    } catch {
      emitServerWarning(ServerEnvironmentValues.loggerFor(this), "Delivery notification failed.", {
        operation: "delivery.notify",
        reasonCode: "failed",
      });
    }
  }

  async #whenDeliveryIdle(): Promise<void> {
    const settled = await Promise.allSettled([
      this.#supervisor?.whenIdle(),
      this.#delivery?.whenIdle(),
    ]);
    const failures = settled.flatMap((result): unknown[] =>
      result.status === "rejected" ? [result.reason as unknown] : [],
    );
    if (failures.length === 1) throw failures[0];
    if (failures.length)
      throw new AggregateError(failures, "Environment Delivery idle wait failed.");
  }

  async #replayMessage(message: InboxMessage): Promise<void> {
    const context = EnvironmentContextRegistrations.forEnvironment(this).recipient(
      message.inboxId.targetTypeUrl,
    );
    if (context === undefined) throw new Error("No open Bounded Context serves the Inbox target.");
    await boundedContextAccess.trackReplay(context, () =>
      boundedContextAccess.delivery(context).replay(message, deliveryTenant(message)),
    );
  }
}

interface RequiredFacilities {
  readonly storageFactory: StorageFactory;
  readonly tenantIndex: TenantIndex | undefined;
  readonly integrationChannelFactory: TransportFactory;
  readonly typeRegistry: TypeRegistryLookup;
  readonly delivery: ServerEnvironmentCloseable | undefined;
  readonly deliveryStrategy: DeliveryStrategy | undefined;
  readonly tracerFactory: ServerEnvironmentCloseable | undefined;
  readonly logger: ILogLayer;
}

/**
 * Provides controlled server-environment lifecycle operations for package owners.
 *
 * @internal
 */
export const ServerEnvironmentLifecycle: { readonly resetForTest: () => Promise<void> } =
  Object.freeze({
    // prettier-ignore

    /**
     * Resets singleton facilities to deterministic local defaults for the next package test.
     */
    resetForTest(): Promise<void> {
      const current = resetInProgress;
      if (current !== undefined) {
        return current;
      }
      const resolved = resolvedEnvironment;
      if (resolved !== undefined && EnvironmentContextRegistrations.forEnvironment(resolved).active) {
        return Promise.reject(new Error("Cannot reset ServerEnvironment with active Bounded Contexts."));
      }
      const reset = Promise.resolve()
        .then(() => {
          if (resolved !== undefined && EnvironmentContextRegistrations.forEnvironment(resolved).active) {
            throw new Error("Cannot reset ServerEnvironment with active Bounded Contexts.");
          }
          if (resolved !== undefined && startupControls.get(resolved)?.failed())
            return resolved.close().catch(() => undefined);
          return resolved?.close();
        })
        .then(() => {
          resolvedEnvironment = undefined;
          configuredSettings.clear();
          EnvironmentTests.reset();
        })
        .finally(() => {
          resetInProgress = undefined;
        });
      resetInProgress = reset;
      return reset;
    },
  });

interface ServerEnvironmentAccess {
  /**
   * Returns the retained runtime behind the public Delivery facade.
   * @param environment Resolved environment after explicit setup.
   * @returns The one shared Delivery core.
   */
  coreDelivery(environment: ServerEnvironment): CoreDelivery;

  /**
   * Returns whether setup installed a remote Delivery supervisor.
   * @param environment Resolved environment after setup.
   * @returns True only for a supervised remote source.
   */
  remoteSupervised(environment: ServerEnvironment): boolean;

  /**
   * Waits for admitted environment Delivery work without closing the facility.
   * @param environment Resolved environment.
   * @returns Completion after active shard runs settle.
   */
  whenDeliveryIdle(environment: ServerEnvironment): Promise<void>;

  /**
   * Notifies the single environment Delivery about a newly eligible shard.
   * @param environment Resolved environment.
   * @param shard Physical shared shard.
   */
  notifyDelivery(
    environment: ServerEnvironment,
    shard: import("../delivery/shard-index.js").ShardIndex,
  ): void;

  /**
   * Waits for explicitly started shared setup before a context assembles.
   * @param environment Resolved environment.
   * @returns Shared setup completion or a missing-setup error.
   */
  awaitSetup(environment: ServerEnvironment): Promise<void>;

  /**
   * Records a build before asynchronous model discovery.
   *
   * @param environment Resolved environment.
   * @returns Callback that marks this build settled.
   */
  beginContextBuild(environment: ServerEnvironment): () => void;

  /**
   * Marks the environment unavailable after a required startup failure.
   *
   * @param environment Environment whose required phase failed.
   * @param cause Original provider, monitor, or transport error.
   */
  failStartup(environment: ServerEnvironment, cause: unknown): void;

  /**
   * Waits for the automatic cleanup and reports original and cleanup failures.
   * @param environment Failed environment.
   * @returns Rejection after cleanup settles.
   */
  awaitStartupFailure(environment: ServerEnvironment): Promise<never>;

  /**
   * Checks whether a required startup phase already failed.
   * @param environment Resolved environment.
   * @returns Whether automatic fatal cleanup is active.
   */
  hasStartupFailure(environment: ServerEnvironment): boolean;

  /**
   * Records a local rollback error without treating it as a new startup cause.
   * @param environment Failed environment.
   * @param error Local rollback failure.
   */
  recordStartupCleanup(environment: ServerEnvironment, error: unknown): void;

  /**
   * Checks the synchronous startup admission fence.
   * @param environment Resolved environment.
   */
  requireAvailable(environment: ServerEnvironment): void;

  /**
   * Records a constructed context, including an empty one.
   *
   * @param environment Resolved environment.
   * @param context Constructed context.
   */
  addContext(environment: ServerEnvironment, context: BoundedContext): void;

  /**
   * Marks a constructed context ready after integration opens.
   *
   * @param environment Resolved environment.
   * @param context Ready context.
   * @returns Completion after recipient registration and supervisor start.
   */
  completeContext(environment: ServerEnvironment, context: BoundedContext): Promise<void>;

  /**
   * Registers a state type and returns a conflicting domain context, if any.
   *
   * @param environment Resolved environment.
   * @param context Context declaring the state.
   * @param typeUrl Full Entity state type URL.
   * @returns A conflicting context, if one exists.
   */
  reserveState(
    environment: ServerEnvironment,
    context: BoundedContext,
    typeUrl: string,
  ): BoundedContext | undefined;

  /**
   * Stops only this context's fresh shared-recipient selection.
   * @param environment Environment registering recipients.
   * @param context Context entering close.
   */
  stopRecipients(environment: ServerEnvironment, context: BoundedContext): void;

  /**
   * Removes a context after its recipients have stopped.
   *
   * @param environment Resolved environment.
   * @param context Closed context.
   */
  removeContext(environment: ServerEnvironment, context: BoundedContext): void;

  /**
   * Returns zero or one domain context names serving a state type.
   *
   * @param environment Resolved environment.
   * @param typeUrl Full Entity state type URL.
   * @returns Matching context names.
   */
  contextsServing(environment: ServerEnvironment, typeUrl: string): readonly string[];

  /**
   * Lists actual open contexts for explicit test cleanup and internal inspection.
   *
   * @param environment Resolved environment.
   * @returns Current context references.
   */
  openContexts(environment: ServerEnvironment): readonly BoundedContext[];

  /**
   * Returns the environment logger.
   *
   * @param environment Resolved server environment.
   * @returns Its configured logger.
   */
  loggerFor(environment: ServerEnvironment): ILogLayer;

  /**
   * Records a warning when a production context uses a volatile registry.
   *
   * @param environment Resolved server environment.
   * @param context Context whose registry is inspected.
   */
  warnVolatileRegistry(environment: ServerEnvironment, context: BoundedContext): void;
}

const environmentSetups = new WeakMap<ServerEnvironment, Promise<void>>();
const startupControls = new WeakMap<
  ServerEnvironment,
  {
    readonly fail: (cause: unknown) => void;
    readonly awaitFailure: () => Promise<never>;
    readonly available: () => void;
    readonly failed: () => boolean;
    readonly recordCleanup: (error: unknown) => void;
  }
>();
const environmentDeliveryCores = new WeakMap<ServerEnvironment, CoreDelivery>();
const remoteSupervisedEnvironments = new WeakSet<ServerEnvironment>();
const environmentLoggers = new WeakMap<ServerEnvironment, ILogLayer>();
const supervisorStarters = new WeakMap<ServerEnvironment, () => Promise<void>>();
const deliveryNotifiers = new WeakMap<
  ServerEnvironment,
  (shard: import("../delivery/shard-index.js").ShardIndex) => void
>();
const deliveryIdlers = new WeakMap<ServerEnvironment, () => Promise<void>>();
const warnedVolatileRegistries = new WeakMap<ServerEnvironment, WeakSet<BoundedContext>>();
const environmentContexts = new WeakMap<ServerEnvironment, EnvironmentContextRegistrations>();

/**
 * Records live domain contexts separately from build-phase reservations.
 */
class EnvironmentContextRegistrations {
  readonly #contexts = new Set<BoundedContext>();

  readonly #completed = new Set<BoundedContext>();

  readonly #states = new Map<string, BoundedContext>();

  readonly #recipients = new Map<string, BoundedContext>();

  #builds = 0;

  #buildsIdle: PromiseWithResolvers<undefined> | undefined;

  /**
   * Finds the registrations attached to one resolved environment.
   *
   * @param environment Resolved environment.
   * @returns Its context registrations.
   */
  static forEnvironment(environment: ServerEnvironment): EnvironmentContextRegistrations {
    const contexts = environmentContexts.get(environment);
    if (contexts === undefined)
      throw new TypeError("Context registration requires an environment.");
    return contexts;
  }

  /**
   * Checks whether a full singleton reset would discard context state.
   *
   * @returns Whether a context or build remains active.
   */
  get active(): boolean {
    return this.#builds > 0 || this.#contexts.size > 0;
  }

  /**
   * Records a build until asynchronous assembly settles.
   *
   * @returns A callback that finishes this build exactly once.
   */
  beginBuild(): () => void {
    if (this.#builds === 0) this.#buildsIdle = Promise.withResolvers<undefined>();
    this.#builds++;
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      this.#builds--;
      if (this.#builds === 0) this.#buildsIdle?.resolve(undefined);
    };
  }

  /**
   * Waits until every admitted build releases its local assembly ticket.
   * @returns Completion when no build remains.
   */
  whenBuildsIdle(): Promise<void> {
    return this.#buildsIdle?.promise ?? Promise.resolve();
  }

  /**
   * Lists constructed contexts, including incomplete registrations.
   * @returns Snapshot of all constructed contexts.
   */
  allContexts(): readonly BoundedContext[] {
    return [...this.#contexts];
  }

  /**
   * Records an open or partly constructed context.
   *
   * @param context Context to track.
   */
  add(context: BoundedContext): void {
    this.#contexts.add(context);
  }

  /**
   * Marks a tracked context ready for public cleanup enumeration.
   *
   * @param context Context whose integration opened successfully.
   */
  complete(context: BoundedContext): void {
    if (!this.#contexts.has(context)) throw new Error("Context completed after cleanup.");
    this.#completed.add(context);
    for (const endpoint of boundedContextAccess.delivery(context).endpoints())
      this.#recipients.set(endpoint.targetTypeUrl, context);
  }

  /**
   * Finds the completed context registered for a delivery target.
   * @param typeUrl Identifies the target message type.
   * @returns The matching context, if one completed registration.
   */
  recipient(typeUrl: string): BoundedContext | undefined {
    return this.#recipients.get(typeUrl);
  }

  /**
   * Registers one state type without overwriting a different context.
   *
   * @param context Context registering the state.
   * @param typeUrl Full wire type URL of the state.
   * @returns The conflicting context, if another context registered it.
   */
  reserve(context: BoundedContext, typeUrl: string): BoundedContext | undefined {
    const prior = this.#states.get(typeUrl);
    if (prior !== undefined) return prior === context ? undefined : prior;
    this.#states.set(typeUrl, context);
    return undefined;
  }

  /**
   * Removes only registrations made by the selected context.
   *
   * @param context Context that completed shutdown.
   */
  remove(context: BoundedContext): void {
    this.#contexts.delete(context);
    this.#completed.delete(context);
    this.stopRecipients(context);
    for (const [typeUrl, registered] of this.#states) {
      if (registered === context) this.#states.delete(typeUrl);
    }
  }

  /**
   * Removes fresh delivery endpoints while retaining state reservations.
   * @param context Context entering close.
   */
  stopRecipients(context: BoundedContext): void {
    for (const [typeUrl, recipient] of this.#recipients)
      if (recipient === context) this.#recipients.delete(typeUrl);
  }

  /**
   * Lists the context currently serving a state type.
   *
   * @param typeUrl Full wire type URL of the state.
   * @returns Zero or one context names.
   */
  serving(typeUrl: string): readonly string[] {
    const context = this.#states.get(typeUrl);
    return context === undefined ? [] : [context.name.value];
  }

  /**
   * Returns completed context references without releasing them.
   *
   * @returns References to integrated open contexts.
   */
  openContexts(): readonly BoundedContext[] {
    return [...this.#completed];
  }
}

/**
 * Provides package-only environment delivery attachment access for server lifecycle owners.
 *
 * @internal
 */
export const serverEnvironmentAccess: ServerEnvironmentAccess = Object.freeze({
  coreDelivery(environment: ServerEnvironment): CoreDelivery {
    const core = environmentDeliveryCores.get(environment);
    if (core === undefined)
      throw new Error("ServerEnvironment.completeSetup() must finish before Delivery use.");
    return core;
  },
  remoteSupervised(environment: ServerEnvironment): boolean {
    return remoteSupervisedEnvironments.has(environment);
  },
  whenDeliveryIdle(environment: ServerEnvironment): Promise<void> {
    return deliveryIdlers.get(environment)?.() ?? Promise.resolve();
  },
  notifyDelivery(
    environment: ServerEnvironment,
    shard: import("../delivery/shard-index.js").ShardIndex,
  ): void {
    deliveryNotifiers.get(environment)?.(shard);
  },
  awaitSetup(environment: ServerEnvironment) {
    this.requireAvailable(environment);
    return (
      environmentSetups.get(environment) ??
      Promise.reject(
        new Error("Await ServerEnvironment.completeSetup() before building a Bounded Context."),
      )
    ).then(() => {
      this.requireAvailable(environment);
    });
  },
  beginContextBuild(environment: ServerEnvironment): () => void {
    this.requireAvailable(environment);
    return EnvironmentContextRegistrations.forEnvironment(environment).beginBuild();
  },

  /**
   * Starts automatic cleanup after a required startup failure.
   *
   * @param environment Failed environment.
   * @param cause Original required-phase error.
   */
  failStartup(environment: ServerEnvironment, cause: unknown): void {
    startupControls.get(environment)?.fail(cause);
  },
  awaitStartupFailure(environment: ServerEnvironment): Promise<never> {
    const control = startupControls.get(environment);
    if (control === undefined) return Promise.reject(new Error("Unknown ServerEnvironment."));
    return control.awaitFailure();
  },
  hasStartupFailure(environment: ServerEnvironment): boolean {
    return startupControls.get(environment)?.failed() ?? false;
  },

  /**
   * Adds an independent partial-context rollback failure to the fatal result.
   *
   * @param environment Failed environment.
   * @param error Local rollback failure.
   */
  recordStartupCleanup(environment: ServerEnvironment, error: unknown): void {
    startupControls.get(environment)?.recordCleanup(error);
  },
  requireAvailable(environment: ServerEnvironment): void {
    startupControls.get(environment)?.available();
  },
  addContext: (environment: ServerEnvironment, context: BoundedContext) => {
    serverEnvironmentAccess.requireAvailable(environment);
    EnvironmentContextRegistrations.forEnvironment(environment).add(context);
  },
  completeContext: async (environment: ServerEnvironment, context: BoundedContext) => {
    serverEnvironmentAccess.requireAvailable(environment);
    EnvironmentContextRegistrations.forEnvironment(environment).complete(context);
    const endpoints = boundedContextAccess.delivery(context).endpoints();
    if (endpoints.length > 0) await supervisorStarters.get(environment)?.();
    serverEnvironmentAccess.requireAvailable(environment);
    for (const endpoint of endpoints) deliveryNotifiers.get(environment)?.(endpoint.shard);
  },
  reserveState: (environment: ServerEnvironment, context: BoundedContext, typeUrl: string) =>
    EnvironmentContextRegistrations.forEnvironment(environment).reserve(context, typeUrl),
  stopRecipients: (environment: ServerEnvironment, context: BoundedContext) => {
    EnvironmentContextRegistrations.forEnvironment(environment).stopRecipients(context);
  },
  removeContext: (environment: ServerEnvironment, context: BoundedContext) => {
    EnvironmentContextRegistrations.forEnvironment(environment).remove(context);
  },
  contextsServing: (environment: ServerEnvironment, typeUrl: string) =>
    EnvironmentContextRegistrations.forEnvironment(environment).serving(typeUrl),
  openContexts: (environment: ServerEnvironment) =>
    EnvironmentContextRegistrations.forEnvironment(environment).openContexts(),
  loggerFor(environment: ServerEnvironment): ILogLayer {
    return ServerEnvironmentValues.loggerFor(environment);
  },
  warnVolatileRegistry(environment: ServerEnvironment, context: BoundedContext) {
    if (environment.environment.type !== EnvironmentType.Production) return;
    if (boundedContextAccess.subscriptionRegistry(context).persistent) return;
    const warned = warnedVolatileRegistries.get(environment);
    if (warned === undefined) {
      throw new TypeError("Registry warning requires a ServerEnvironment instance.");
    }
    if (warned.has(context)) return;
    warned.add(context);
    // spine-log-boundary: server.volatile_subscription_registry
    emitServerWarning(
      ServerEnvironmentValues.loggerFor(environment),
      "Stand subscription registry is not persistent.",
      { contextName: context.name.value, operation: "stand.registry", reasonCode: "volatile" },
    );
  },
});

/**
 *
 * @internal Groups private facility-assembly operations for the environment singleton.
 */
const ServerEnvironmentValues = Object.freeze({
  /**
   * Returns the installed environment logger.
   *
   * @param environment Resolved server environment.
   * @returns Its logger.
   */
  loggerFor(environment: ServerEnvironment): ILogLayer {
    const logger = environmentLoggers.get(environment);
    if (logger === undefined) throw new TypeError("ServerEnvironment logger is not available.");
    return logger;
  },

  /**
   * Gets an openable delivery facility when configured.
   *
   * @param delivery Configured delivery facility.
   * @returns Openable delivery or undefined.
   */
  openableDelivery(
    delivery: ServerEnvironmentCloseable | undefined,
  ): ServerEnvironmentDelivery | undefined {
    if (delivery === undefined) return undefined;
    const candidate = delivery as Partial<ServerEnvironmentDelivery>;
    if (typeof candidate.open !== "function") return undefined;
    if (
      typeof candidate.close !== "function" ||
      !("inbox" in candidate) ||
      !("workRegistry" in candidate)
    ) {
      throw new TypeError("ServerEnvironmentDelivery requires inbox and workRegistry ports.");
    }
    return candidate as ServerEnvironmentDelivery;
  },

  /**
   * Maps delivery to its environment ports.
   *
   * @param delivery Configured delivery facility.
   * @returns Ports when delivery is openable.
   */
  ports(delivery: ServerEnvironmentCloseable | undefined): EnvironmentDeliveryPorts | undefined {
    const remote = ServerEnvironmentValues.openableDelivery(delivery);
    if (remote === undefined) return undefined;
    return {
      inbox: remote.inbox,
      workRegistry: remote.workRegistry,
      ...(remote.source === undefined ? {} : { source: remote.source }),
    };
  },

  /**
   * Lists facilities closed by the environment.
   *
   * @param options Resolved facilities.
   * @param deliveryCloseGroup Closes the shared Delivery before other facilities.
   * @returns Facilities in shutdown order.
   */
  facilitiesToClose(
    options: RequiredFacilities,
    deliveryCloseGroup: RetryableCloseGroup,
  ): readonly unknown[] {
    return Object.freeze([
      deliveryCloseGroup,
      options.integrationChannelFactory,
      ...(options.tracerFactory === undefined ? [] : [options.tracerFactory]),
      options.storageFactory,
    ]);
  },

  /**
   * Creates a default logger when none was supplied.
   *
   * @param logger Optional application logger.
   * @returns Logger child for this environment.
   */
  logger(logger: ILogLayer | undefined): ILogLayer {
    return (
      logger ??
      new LogLayer({
        transport: new StructuredTransport({
          logger: console,
          level: "warn",
          stringify: true,
          messageField: "message",
          dateField: "timestamp",
          levelField: "severity",
          levelFn: (level) => level.toUpperCase(),
        }),
      })
    ).child();
  },

  /**
   * Resolves configured facilities with local defaults where supported.
   *
   * @param type Selected environment type.
   * @param settings Configured facilities.
   * @returns Complete resolved facilities.
   */
  resolveFacilities(
    type: EnvironmentType,
    settings: ServerEnvironmentSettings,
  ): RequiredFacilities {
    if (type === EnvironmentType.Production) {
      if (settings.storageFactory === undefined) {
        throw new Error("Production ServerEnvironment requires storageFactory.");
      }
      if (settings.typeRegistry === undefined) {
        throw new Error("Production ServerEnvironment requires typeRegistry.");
      }
      return {
        storageFactory: settings.storageFactory,
        tenantIndex: settings.tenantIndex,
        integrationChannelFactory:
          settings.integrationChannelFactory ?? new InMemoryTransportFactory(),
        typeRegistry: settings.typeRegistry,
        delivery: settings.delivery,
        deliveryStrategy: settings.deliveryStrategy,
        tracerFactory: settings.tracerFactory,
        logger: ServerEnvironmentValues.logger(settings.logger),
      };
    }
    return {
      storageFactory: settings.storageFactory ?? new InMemoryStorageFactory(),
      tenantIndex: settings.tenantIndex,
      integrationChannelFactory:
        settings.integrationChannelFactory ?? new InMemoryTransportFactory(),
      typeRegistry: settings.typeRegistry ?? spineCoreRegistry,
      delivery: settings.delivery,
      deliveryStrategy: settings.deliveryStrategy,
      tracerFactory: settings.tracerFactory,
      logger: ServerEnvironmentValues.logger(settings.logger),
    };
  },
});
