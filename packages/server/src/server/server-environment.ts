import { InMemoryStorageFactory, type StorageFactory } from "@spine-event-engine/storage";
import type {
  PublishTransportHandler,
  PublishTransportOperation,
  RequestTransportHandler,
  RequestTransportOperation,
  SignalTransport,
  TransportSignalKind,
  TransportSubscription,
  TransportSubscriptionHandle,
} from "@spine-event-engine/transport";

import { RetryableCloseGroup } from "./retryable-close.js";
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
   * Storage facility selected for server assembly, including server-added context builders.
   */
  readonly storageFactory?: StorageFactory;

  /**
   * Signal transport facility selected for server assembly.
   */
  readonly transport?: SignalTransport;

  /**
   * Optional closeable delivery owner for durable delivery seams.
   */
  readonly delivery?: ServerEnvironmentCloseable;

  /**
   * Optional tracing factory placeholder for later tracing adapters.
   */
  readonly tracerFactory?: ServerEnvironmentCloseable;
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
   * Transport facility selected for this environment.
   */
  readonly transport: SignalTransport;

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

  private constructor(environment: Environment, settings: RequiredFacilities) {
    this.environment = environment;
    this.nodeId = crypto.randomUUID();
    this.storageFactory = settings.storageFactory;
    this.transport = settings.transport;
    this.delivery = settings.delivery;
    this.tracerFactory = settings.tracerFactory;
    this.#ownedCloseables = ServerEnvironmentValues.facilitiesToClose(settings);
    this.#closeGroup = new RetryableCloseGroup(
      this.#ownedCloseables,
      "ServerEnvironment close failed.",
    );
    environmentAttachments.set(
      this,
      new EnvironmentAttachments({
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
  readonly transport: SignalTransport;
  readonly delivery: ServerEnvironmentCloseable | undefined;
  readonly tracerFactory: ServerEnvironmentCloseable | undefined;
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
      const reset = Promise.resolve()
        .then(() => resolved?.close())
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
  attach(
    environment: ServerEnvironment,
    options: EnvironmentAttachOptions,
  ): Promise<EnvironmentAttachmentHandle>;
  failedStartPending(environment: ServerEnvironment): boolean;
  failedStartRetryPending(environment: ServerEnvironment, error: unknown): boolean;
  retryFailedStart(environment: ServerEnvironment): Promise<void>;
  detach(environment: ServerEnvironment, attachment: EnvironmentAttachmentHandle): Promise<void>;
  retryDetach(
    environment: ServerEnvironment,
    attachment: EnvironmentAttachmentHandle,
  ): Promise<void>;
  detachRetryPending(
    environment: ServerEnvironment,
    attachment: EnvironmentAttachmentHandle,
  ): boolean;
  endpointSafe(environment: ServerEnvironment, attachment: EnvironmentAttachmentHandle): boolean;
  stopDelivery(environment: ServerEnvironment): Promise<void>;
  retryDeliveryStop(environment: ServerEnvironment): Promise<void>;
  installTestAttachments(
    environment: ServerEnvironment,
    createWorker: () => EnvironmentGenerationWorker,
  ): void;
}

const environmentAttachments = new WeakMap<ServerEnvironment, EnvironmentAttachments>();
const deliveryOpeners = new WeakMap<ServerEnvironment, () => Promise<void>>();
const testAttachmentsInstallable = new WeakSet<ServerEnvironment>();

/**
 * Provides package-only environment delivery attachment access for server lifecycle owners.
 *
 * @internal
 */
export const serverEnvironmentAccess: ServerEnvironmentAccess = Object.freeze({
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
    environmentAttachments.set(environment, new EnvironmentAttachments({ createWorker }));
  },
});

/**
 *
 * @internal Groups private facility-assembly operations for the environment singleton.
 */
const ServerEnvironmentValues = Object.freeze({
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
  ports(delivery: ServerEnvironmentCloseable | undefined): EnvironmentDeliveryPorts | undefined {
    const remote = ServerEnvironmentValues.openableDelivery(delivery);
    if (remote === undefined) return undefined;
    return {
      inbox: remote.inbox,
      workRegistry: remote.workRegistry,
      ...(remote.source === undefined ? {} : { source: remote.source }),
    };
  },
  facilitiesToClose(options: RequiredFacilities): readonly unknown[] {
    return Object.freeze([
      ...(options.delivery === undefined ? [] : [options.delivery]),
      options.transport,
      ...(options.tracerFactory === undefined ? [] : [options.tracerFactory]),
      options.storageFactory,
    ]);
  },
  resolveFacilities(
    type: EnvironmentType,
    settings: ServerEnvironmentSettings,
  ): RequiredFacilities {
    if (type === EnvironmentType.Production) {
      if (settings.storageFactory === undefined) {
        throw new Error("Production ServerEnvironment requires storageFactory.");
      }
      if (settings.transport === undefined) {
        throw new Error("Production ServerEnvironment requires transport.");
      }
      return {
        storageFactory: settings.storageFactory,
        transport: settings.transport,
        delivery: settings.delivery,
        tracerFactory: settings.tracerFactory,
      };
    }
    return {
      storageFactory: settings.storageFactory ?? new InMemoryStorageFactory(),
      transport: settings.transport ?? new LocalSignalTransport(),
      delivery: settings.delivery,
      tracerFactory: settings.tracerFactory,
    };
  },
});

class LocalSignalTransport implements SignalTransport {
  readonly #publishHandlers = new Map<string, Set<PublishTransportHandler>>();
  readonly #requestHandlers = new Map<string, RequestTransportHandler>();
  #closed = false;

  async publish<Envelope, Kind extends TransportSignalKind>(
    operation: PublishTransportOperation<Envelope, Kind>,
  ): Promise<void> {
    this.#requireOpen();
    const handlers = this.#publishHandlers.get(operation.topic.routing.routingKey);

    if (handlers === undefined) {
      return;
    }

    await Promise.all([...handlers].map(async (handler) => handler(operation)));
  }

  subscribe<Envelope, Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    handler: PublishTransportHandler<Envelope, Kind>,
  ): Promise<TransportSubscriptionHandle<Kind>> {
    try {
      this.#requireOpen();
      const key = subscription.topic.routing.routingKey;
      const handlers = this.#publishHandlers.get(key) ?? new Set();
      const stored = handler as PublishTransportHandler;

      handlers.add(stored);
      this.#publishHandlers.set(key, handlers);

      return Promise.resolve(
        new LocalTransportSubscriptionHandle(subscription, () => {
          handlers.delete(stored);
          if (handlers.size === 0) {
            this.#publishHandlers.delete(key);
          }
        }),
      );
    } catch (error: unknown) {
      return Promise.reject(new Error(String(error)));
    }
  }

  async request<RequestEnvelope, ResponseEnvelope, Kind extends TransportSignalKind>(
    operation: RequestTransportOperation<RequestEnvelope, Kind>,
  ): Promise<ResponseEnvelope> {
    this.#requireOpen();
    const handler = this.#requestHandlers.get(operation.topic.routing.routingKey);

    if (handler === undefined) {
      throw new Error(
        `No local transport responder is registered for "${operation.topic.routing.routingKey}".`,
      );
    }

    return Promise.resolve(handler(operation) as ResponseEnvelope | Promise<ResponseEnvelope>);
  }

  respond<RequestEnvelope, ResponseEnvelope, Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    handler: RequestTransportHandler<RequestEnvelope, ResponseEnvelope, Kind>,
  ): Promise<TransportSubscriptionHandle<Kind>> {
    try {
      this.#requireOpen();
      const key = subscription.topic.routing.routingKey;

      if (this.#requestHandlers.has(key)) {
        throw new Error(`Local transport responder is already registered for "${key}".`);
      }

      const stored = handler as RequestTransportHandler;
      this.#requestHandlers.set(key, stored);

      return Promise.resolve(
        new LocalTransportSubscriptionHandle(subscription, () => {
          this.#requestHandlers.delete(key);
        }),
      );
    } catch (error: unknown) {
      return Promise.reject(new Error(String(error)));
    }
  }

  close(): Promise<void> {
    this.#closed = true;
    this.#publishHandlers.clear();
    this.#requestHandlers.clear();
    return Promise.resolve();
  }

  #requireOpen(): void {
    if (this.#closed) {
      throw new Error("Local signal transport is closed.");
    }
  }
}

class LocalTransportSubscriptionHandle<
  Kind extends TransportSignalKind,
> implements TransportSubscriptionHandle<Kind> {
  readonly subscription: TransportSubscription<Kind>;
  readonly #onClose: () => void;
  #closed = false;

  constructor(subscription: TransportSubscription<Kind>, onClose: () => void) {
    this.subscription = subscription;
    this.#onClose = onClose;
  }

  close(): Promise<void> {
    if (!this.#closed) {
      this.#closed = true;
      this.#onClose();
    }
    return Promise.resolve();
  }
}
