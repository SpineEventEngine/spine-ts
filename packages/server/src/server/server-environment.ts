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
import { LogLayer, StructuredTransport, type ILogLayer } from "loglayer";
import { InMemoryTransportFactory, type TransportFactory } from "@spine-event-engine/transport";
import { spineCoreRegistry, type TypeRegistryLookup } from "@spine-event-engine/core";

import { RetryableCloseGroup } from "./retryable-close.js";
import { emitServerWarning } from "./server-log.js";
import { boundedContextAccess, type BoundedContext } from "../context/bounded-context.js";
import { TenantIndexes, type TenantIndex } from "../context/tenant-index.js";
import type { EnvironmentDeliveryPorts } from "../context/local-inbox-handoff.js";
import type { DeliveryInbox, DeliveryWorkRegistry } from "../delivery/delivery-ports.js";
import type { DeliverySource } from "../delivery/delivery-supervisor.js";
import { EnvironmentDeliveryWorker } from "./environment-delivery-worker.js";
import {
  EnvironmentAttachments,
  type EnvironmentAttachOptions,
  type EnvironmentAttachmentHandle,
  type EnvironmentGenerationWorker,
} from "./environment-attachment.js";
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
 * A closeable environment facility that must open before attachment admission.
 */
export interface ServerEnvironmentDelivery extends ServerEnvironmentCloseable {
  // prettier-ignore

  /**
   * Opens the facility before the environment admits attachments.
   *
   * @returns An optional asynchronous open operation.
   */
  open(): unknown;

  /**
   * Supplies the inbox port used by environment delivery generations.
   */
  readonly inbox: DeliveryInbox;

  /**
   * Supplies the shard work-registry port used by environment delivery generations.
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
   * Optional closeable delivery owner for durable delivery seams.
   */
  readonly delivery?: ServerEnvironmentCloseable;

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
   * Optional closeable delivery owner selected for this environment.
   */
  readonly delivery: ServerEnvironmentCloseable | undefined;

  /**
   * Optional tracing factory selected for this environment.
   */
  readonly tracerFactory: ServerEnvironmentCloseable | undefined;

  readonly #ownedCloseables: readonly unknown[];

  readonly #closeGroup: RetryableCloseGroup;

  #close: Promise<void> | undefined;

  #deliveryOpen: Promise<void> | undefined;

  #deliveryOpened = false;

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
    this.delivery = settings.delivery;
    this.tracerFactory = settings.tracerFactory;
    environmentLoggers.set(this, settings.logger);
    environmentContexts.set(this, new EnvironmentContextRegistrations());
    this.#ownedCloseables = ServerEnvironmentValues.facilitiesToClose(settings);
    warnedVolatileRegistries.set(this, new WeakSet());
    this.#closeGroup = new RetryableCloseGroup(
      this.#ownedCloseables,
      "ServerEnvironment close failed.",
    );
    environmentAttachments.set(
      this,
      new EnvironmentAttachments({
        logger: ServerEnvironmentValues.loggerFor(this),
        createWorker: () => {
          const ports = ServerEnvironmentValues.ports(this.delivery);
          return new EnvironmentDeliveryWorker({
            ...(ports === undefined ? {} : { ports }),
            nodeId: this.nodeId,
          });
        },
        deliveryPorts: () => ServerEnvironmentValues.ports(this.delivery),
      }),
    );
    deliveryOpeners.set(this, () => this.#openDelivery());
    testAttachmentsInstallable.add(this);
    Object.freeze(this);
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
   * Closes this environment after all attached servers retire.
   *
   * Admission permanently closes the environment and prevents reuse. If it is
   * in use, closure rejects without owned-facility teardown. Failed facility
   * closes are retryable and already closed facilities are not closed again.
   *
   * @returns A promise that settles after the environment and owned facilities close.
   *
   */
  close(): Promise<void> {
    testAttachmentsInstallable.delete(this);
    this.#close ??= this.#attachments()
      .admitPermanentClose()
      .then(() => this.#closeGroup.close())
      .catch((error: unknown) => {
        this.#close = undefined;
        throw error;
      });
    return this.#close;
  }

  #openDelivery(): Promise<void> {
    if (this.#deliveryOpened) return Promise.resolve();
    const opening = (this.#deliveryOpen ??= Promise.resolve()
      .then(() => {
        const delivery = ServerEnvironmentValues.openableDelivery(this.delivery);
        if (delivery !== undefined) {
          return delivery.open();
        }
        return undefined;
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

  #attachments(): EnvironmentAttachments {
    const attachments = environmentAttachments.get(this);
    if (attachments === undefined) {
      throw new Error("ServerEnvironment attachments are not available.");
    }
    return attachments;
  }
}

interface RequiredFacilities {
  readonly storageFactory: StorageFactory;
  readonly tenantIndex: TenantIndex | undefined;
  readonly integrationChannelFactory: TransportFactory;
  readonly typeRegistry: TypeRegistryLookup;
  readonly delivery: ServerEnvironmentCloseable | undefined;
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
   * Records a build before asynchronous model discovery.
   *
   * @param environment Resolved environment.
   * @returns Callback that marks this build settled.
   */
  beginContextBuild(environment: ServerEnvironment): () => void;

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
   */
  completeContext(environment: ServerEnvironment, context: BoundedContext): void;

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
   * Attaches a context delivery generation.
   *
   * @param environment Resolved server environment.
   * @param options Delivery attachment options.
   * @returns Installed attachment handle.
   */
  attach(
    environment: ServerEnvironment,
    options: EnvironmentAttachOptions,
  ): Promise<EnvironmentAttachmentHandle>;

  /**
   * Checks whether startup failure remains pending.
   *
   * @param environment Resolved server environment.
   * @returns Whether startup failure remains pending.
   */
  failedStartPending(environment: ServerEnvironment): boolean;

  /**
   * Checks whether failed-start retry remains pending.
   *
   * @param environment Resolved server environment.
   * @param error Failure to inspect.
   * @returns Whether retry remains pending.
   */
  failedStartRetryPending(environment: ServerEnvironment, error: unknown): boolean;

  /**
   * Retries failed startup.
   *
   * @param environment Resolved server environment.
   * @returns Retry completion.
   */
  retryFailedStart(environment: ServerEnvironment): Promise<void>;

  /**
   * Removes one delivery attachment.
   *
   * @param environment Resolved server environment.
   * @param attachment Attachment to remove.
   * @returns Detach completion.
   */
  detach(environment: ServerEnvironment, attachment: EnvironmentAttachmentHandle): Promise<void>;

  /**
   * Retries a failed detach.
   *
   * @param environment Resolved server environment.
   * @param attachment Attachment to retry.
   * @returns Retry completion.
   */
  retryDetach(
    environment: ServerEnvironment,
    attachment: EnvironmentAttachmentHandle,
  ): Promise<void>;

  /**
   * Checks whether detach retry remains pending.
   *
   * @param environment Resolved server environment.
   * @param attachment Attachment to inspect.
   * @returns Whether retry remains pending.
   */
  detachRetryPending(
    environment: ServerEnvironment,
    attachment: EnvironmentAttachmentHandle,
  ): boolean;

  /**
   * Checks whether an attachment endpoint can be used.
   *
   * @param environment Resolved server environment.
   * @param attachment Attachment to inspect.
   * @returns Whether endpoint use is safe.
   */
  endpointSafe(environment: ServerEnvironment, attachment: EnvironmentAttachmentHandle): boolean;

  /**
   * Stops environment delivery.
   *
   * @param environment Resolved server environment.
   * @returns Delivery shutdown completion.
   */
  stopDelivery(environment: ServerEnvironment): Promise<void>;

  /**
   * Retries environment delivery shutdown.
   *
   * @param environment Resolved server environment.
   * @returns Delivery shutdown retry completion.
   */
  retryDeliveryStop(environment: ServerEnvironment): Promise<void>;

  /**
   * Sets deterministic test attachment workers before lifecycle use.
   *
   * @param environment Resolved server environment.
   * @param createWorker Worker constructor.
   */
  installTestAttachments(
    environment: ServerEnvironment,
    createWorker: () => EnvironmentGenerationWorker,
  ): void;

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

const environmentAttachments = new WeakMap<ServerEnvironment, EnvironmentAttachments>();
const environmentLoggers = new WeakMap<ServerEnvironment, ILogLayer>();
const deliveryOpeners = new WeakMap<ServerEnvironment, () => Promise<void>>();
const testAttachmentsInstallable = new WeakSet<ServerEnvironment>();
const warnedVolatileRegistries = new WeakMap<ServerEnvironment, WeakSet<BoundedContext>>();
const environmentContexts = new WeakMap<ServerEnvironment, EnvironmentContextRegistrations>();

/**
 * Records live domain contexts separately from build-phase reservations.
 */
class EnvironmentContextRegistrations {
  readonly #contexts = new Set<BoundedContext>();

  readonly #completed = new Set<BoundedContext>();

  readonly #states = new Map<string, BoundedContext>();

  #builds = 0;

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
    this.#builds++;
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      this.#builds--;
    };
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
    for (const [typeUrl, registered] of this.#states) {
      if (registered === context) this.#states.delete(typeUrl);
    }
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
  beginContextBuild: (environment: ServerEnvironment) =>
    EnvironmentContextRegistrations.forEnvironment(environment).beginBuild(),
  addContext: (environment: ServerEnvironment, context: BoundedContext) => {
    EnvironmentContextRegistrations.forEnvironment(environment).add(context);
  },
  completeContext: (environment: ServerEnvironment, context: BoundedContext) => {
    EnvironmentContextRegistrations.forEnvironment(environment).complete(context);
  },
  reserveState: (environment: ServerEnvironment, context: BoundedContext, typeUrl: string) =>
    EnvironmentContextRegistrations.forEnvironment(environment).reserve(context, typeUrl),
  removeContext: (environment: ServerEnvironment, context: BoundedContext) => {
    EnvironmentContextRegistrations.forEnvironment(environment).remove(context);
  },
  contextsServing: (environment: ServerEnvironment, typeUrl: string) =>
    EnvironmentContextRegistrations.forEnvironment(environment).serving(typeUrl),
  openContexts: (environment: ServerEnvironment) =>
    EnvironmentContextRegistrations.forEnvironment(environment).openContexts(),
  attach(environment: ServerEnvironment, options: EnvironmentAttachOptions) {
    testAttachmentsInstallable.delete(environment);
    const attachments = environmentAttachments.get(environment);
    if (attachments === undefined) {
      return Promise.reject(new TypeError("Attachment requires a ServerEnvironment instance."));
    }
    const openDelivery = deliveryOpeners.get(environment);
    if (openDelivery === undefined) {
      return Promise.reject(new TypeError("Attachment requires a ServerEnvironment instance."));
    }
    return openDelivery().then(() => attachments.attach(options));
  },
  failedStartPending(environment: ServerEnvironment) {
    const attachments = environmentAttachments.get(environment);
    if (attachments === undefined) {
      throw new TypeError("Failed-start observation requires a ServerEnvironment instance.");
    }
    return attachments.failedStartPending;
  },
  failedStartRetryPending(environment: ServerEnvironment, error: unknown) {
    const attachments = environmentAttachments.get(environment);
    if (attachments === undefined) {
      throw new TypeError("Failed-start retry observation requires a ServerEnvironment instance.");
    }
    return attachments.failedStartRetryPending(error);
  },
  retryFailedStart(environment: ServerEnvironment) {
    testAttachmentsInstallable.delete(environment);
    const attachments = environmentAttachments.get(environment);
    if (attachments === undefined) {
      return Promise.reject(new TypeError("Rollback retry requires a ServerEnvironment instance."));
    }
    return attachments.retryFailedStart();
  },
  detach(environment: ServerEnvironment, attachment: EnvironmentAttachmentHandle) {
    testAttachmentsInstallable.delete(environment);
    const attachments = environmentAttachments.get(environment);
    if (attachments === undefined) {
      return Promise.reject(new TypeError("Detach requires a ServerEnvironment instance."));
    }
    return attachments.detach(attachment);
  },
  retryDetach(environment: ServerEnvironment, attachment: EnvironmentAttachmentHandle) {
    testAttachmentsInstallable.delete(environment);
    const attachments = environmentAttachments.get(environment);
    if (attachments === undefined) {
      return Promise.reject(new TypeError("Detach retry requires a ServerEnvironment instance."));
    }
    return attachments.retryDetach(attachment);
  },
  detachRetryPending(environment: ServerEnvironment, attachment: EnvironmentAttachmentHandle) {
    const attachments = environmentAttachments.get(environment);
    if (attachments === undefined) {
      throw new TypeError("Detach-retry observation requires a ServerEnvironment instance.");
    }
    return attachments.detachRetryPending(attachment);
  },
  endpointSafe(environment: ServerEnvironment, attachment: EnvironmentAttachmentHandle) {
    const attachments = environmentAttachments.get(environment);
    if (attachments === undefined) {
      throw new TypeError("Endpoint-safety observation requires a ServerEnvironment instance.");
    }
    return attachments.endpointSafe(attachment);
  },
  stopDelivery(environment: ServerEnvironment) {
    testAttachmentsInstallable.delete(environment);
    const attachments = environmentAttachments.get(environment);
    if (attachments === undefined) {
      return Promise.reject(new TypeError("Delivery stop requires a ServerEnvironment instance."));
    }
    return attachments.stopDelivery();
  },
  retryDeliveryStop(environment: ServerEnvironment) {
    testAttachmentsInstallable.delete(environment);
    const attachments = environmentAttachments.get(environment);
    if (attachments === undefined) {
      return Promise.reject(
        new TypeError("Delivery stop retry requires a ServerEnvironment instance."),
      );
    }
    return attachments.retryDeliveryStop();
  },
  installTestAttachments(
    environment: ServerEnvironment,
    createWorker: () => EnvironmentGenerationWorker,
  ) {
    if (!environmentAttachments.has(environment)) {
      throw new TypeError("Test attachments require a ServerEnvironment instance.");
    }
    if (!testAttachmentsInstallable.delete(environment)) {
      throw new Error("Test attachments may only be installed before environment lifecycle use.");
    }
    environmentAttachments.set(
      environment,
      new EnvironmentAttachments({
        logger: ServerEnvironmentValues.loggerFor(environment),
        createWorker,
      }),
    );
  },
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
   * @returns Facilities in shutdown order.
   */
  facilitiesToClose(options: RequiredFacilities): readonly unknown[] {
    return Object.freeze([
      ...(options.delivery === undefined ? [] : [options.delivery]),
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
      tracerFactory: settings.tracerFactory,
      logger: ServerEnvironmentValues.logger(settings.logger),
    };
  },
});
