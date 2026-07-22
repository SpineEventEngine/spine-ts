import { InMemoryStorageFactory, type StorageFactory } from "@spine-ts/storage";
import type {
  PublishTransportHandler,
  PublishTransportOperation,
  RequestTransportHandler,
  RequestTransportOperation,
  SignalTransport,
  TransportSignalKind,
  TransportSubscription,
  TransportSubscriptionHandle,
} from "@spine-ts/transport";

import { RetryableCloseGroup } from "./retryable-close.js";
import {
  EnvironmentAttachments,
  type EnvironmentAttachOptions,
  type EnvironmentAttachmentHandle,
  type EnvironmentGenerationWorker,
} from "./environment-attachment.js";
import { Environment, EnvironmentType, resetEnvironmentForTest } from "./environment.js";

/** Common closeable facility owned by a server environment. */
export interface ServerEnvironmentCloseable {
  /** Close the facility. May be synchronous or asynchronous. */
  close(): unknown;
}

/** Facilities configured for one Node environment type. */
export interface ServerEnvironmentSettings {
  /** Storage facility selected for server assembly, including server-added context builders. */
  readonly storageFactory?: StorageFactory;
  /** Signal transport facility selected for server assembly. */
  readonly transport?: SignalTransport;
  /** Optional closeable delivery owner for durable delivery seams. */
  readonly delivery?: ServerEnvironmentCloseable;
  /** Optional tracing factory placeholder for later tracing adapters. */
  readonly tracerFactory?: ServerEnvironmentCloseable;
}

export type ServerEnvironmentSettingsFactory = () => ServerEnvironmentSettings;
type SettingsInput = ServerEnvironmentSettings | ServerEnvironmentSettingsFactory;
const configuredSettings = new Map<EnvironmentType, SettingsInput>();
let resolvedEnvironment: ServerEnvironment | undefined;
let resetInProgress: Promise<void> | undefined;

/**
 * Process-wide server facilities for the canonical {@link Environment}.
 */
export class ServerEnvironment implements ServerEnvironmentCloseable {
  /** The environment whose settings resolved these facilities. */
  readonly environment: Environment;
  /** Stable identity shared by every server in this singleton lifecycle. */
  readonly nodeId: string;
  /** Storage facility selected for server assembly, including server-added context builders. */
  readonly storageFactory: StorageFactory;
  /** Transport facility selected for this environment. */
  readonly transport: SignalTransport;
  /** Optional closeable delivery owner selected for this environment. */
  readonly delivery: ServerEnvironmentCloseable | undefined;
  /** Optional tracing factory selected for this environment. */
  readonly tracerFactory: ServerEnvironmentCloseable | undefined;

  readonly #ownedCloseables: readonly unknown[];
  readonly #closeGroup: RetryableCloseGroup;
  #close: Promise<void> | undefined;

  private constructor(environment: Environment, settings: RequiredFacilities) {
    this.environment = environment;
    this.nodeId = crypto.randomUUID();
    this.storageFactory = settings.storageFactory;
    this.transport = settings.transport;
    this.delivery = settings.delivery;
    this.tracerFactory = settings.tracerFactory;
    this.#ownedCloseables = facilitiesToClose(settings);
    this.#closeGroup = new RetryableCloseGroup(
      this.#ownedCloseables,
      "ServerEnvironment close failed.",
    );
    environmentAttachments.set(this, new EnvironmentAttachments());
    testAttachmentsInstallable.add(this);
    Object.freeze(this);
  }

  /** Select facilities for one environment type before first resolution. */
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

  /** Resolve this module graph's configured server facilities exactly once. */
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
    const facilities = resolveFacilities(environment.type, settings ?? {});
    return new ServerEnvironment(environment, facilities);
  }

  /**
   * Permanently close this environment after it is no longer in use.
   *
   * After admission the environment is permanently closed and cannot be reused.
   *
   * If the environment is in use, close rejects non-destructively and performs no owned-facility
   * teardown. Failed facility-close attempts may be retried; facilities that already closed
   * successfully are not closed again.
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

/** @internal Test-only singleton reset behind the package testing subpath. */
export function resetServerEnvironmentForTest(): Promise<void> {
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
      resetEnvironmentForTest();
    })
    .finally(() => {
      resetInProgress = undefined;
    });
  resetInProgress = reset;
  return reset;
}

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
const testAttachmentsInstallable = new WeakSet<ServerEnvironment>();

/** @internal Package-only environment delivery attachment access for later server lifecycle use. */
export const serverEnvironmentAccess: ServerEnvironmentAccess = Object.freeze({
  attach(environment: ServerEnvironment, options: EnvironmentAttachOptions) {
    testAttachmentsInstallable.delete(environment);
    const attachments = environmentAttachments.get(environment);
    if (attachments === undefined) {
      return Promise.reject(new TypeError("Attachment requires a ServerEnvironment instance."));
    }
    return attachments.attach(options);
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

function facilitiesToClose(options: RequiredFacilities): readonly unknown[] {
  return Object.freeze([
    ...(options.delivery === undefined ? [] : [options.delivery]),
    ...(options.tracerFactory === undefined ? [] : [options.tracerFactory]),
    options.transport,
    options.storageFactory,
  ]);
}

function resolveFacilities(
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
}

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
