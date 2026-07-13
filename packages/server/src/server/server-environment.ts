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

/** Deployment profile used by a small explicit server runtime environment. */
export type ServerEnvironmentMode = "local" | "production";

/** Common closeable facility owned by a server environment. */
export interface ServerEnvironmentCloseable {
  /** Close the facility. May be synchronous or asynchronous. */
  close(): unknown;
}

/** Optional ownership flags for environment facilities. */
export interface ServerEnvironmentOwnershipOptions {
  /** Whether this environment closes the supplied storage factory. */
  readonly ownsStorageFactory?: boolean;
  /** Whether this environment closes the supplied transport. */
  readonly ownsTransport?: boolean;
  /** Whether this environment closes the supplied delivery owner. */
  readonly ownsDelivery?: boolean;
  /** Whether this environment closes the supplied tracing factory. */
  readonly ownsTracerFactory?: boolean;
}

/** Local/test environment options. Missing storage and transport use in-memory defaults. */
export interface ServerEnvironmentLocalOptions extends ServerEnvironmentOwnershipOptions {
  /** Storage facility selected for server assembly, including server-added context builders. */
  readonly storageFactory?: StorageFactory;
  /** Local signal transport facility. */
  readonly transport?: SignalTransport;
  /** Optional closeable delivery owner for durable delivery seams. */
  readonly delivery?: ServerEnvironmentCloseable;
  /** Optional tracing factory placeholder for later tracing adapters. */
  readonly tracerFactory?: ServerEnvironmentCloseable;
}

/** Production environment options. Storage and transport are required. */
export interface ServerEnvironmentProductionOptions extends ServerEnvironmentOwnershipOptions {
  /** Durable storage facility selected for server assembly, including server-added context builders. */
  readonly storageFactory: StorageFactory;
  /** Signal transport facility supplied by the deployment. */
  readonly transport: SignalTransport;
  /** Optional closeable delivery owner for durable delivery seams. */
  readonly delivery?: ServerEnvironmentCloseable;
  /** Optional tracing factory placeholder for later tracing adapters. */
  readonly tracerFactory?: ServerEnvironmentCloseable;
}

interface ServerEnvironmentConstructorOptions extends ServerEnvironmentOwnershipOptions {
  readonly mode: ServerEnvironmentMode;
  readonly storageFactory: StorageFactory;
  readonly transport: SignalTransport;
  readonly delivery?: ServerEnvironmentCloseable;
  readonly tracerFactory?: ServerEnvironmentCloseable;
}

/**
 * Explicit server runtime environment for storage, transport, delivery, and tracing facilities.
 *
 * This is deliberately a small object, not a process-wide singleton. Local
 * environments use in-memory storage and same-process transport defaults.
 * Production environments require caller-supplied storage and transport before
 * a server is assembled. Server-added context builders use this environment's
 * storage factory unless they selected one explicitly.
 */
export class ServerEnvironment implements ServerEnvironmentCloseable {
  /** Environment deployment profile. */
  readonly mode: ServerEnvironmentMode;
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

  private constructor(options: ServerEnvironmentConstructorOptions) {
    this.mode = options.mode;
    this.storageFactory = options.storageFactory;
    this.transport = options.transport;
    this.delivery = options.delivery;
    this.tracerFactory = options.tracerFactory;
    this.#ownedCloseables = ownedEnvironmentCloseables(options);
    this.#closeGroup = new RetryableCloseGroup(
      this.#ownedCloseables,
      "ServerEnvironment close failed.",
    );
    environmentAttachments.set(this, new EnvironmentAttachments());
    testAttachmentsInstallable.add(this);
    Object.freeze(this);
  }

  /** Create a local/test environment with deterministic in-memory defaults. */
  static local(options: ServerEnvironmentLocalOptions = {}): ServerEnvironment {
    const storageFactory = options.storageFactory ?? new InMemoryStorageFactory();
    const transport = options.transport ?? new LocalSignalTransport();

    return new ServerEnvironment({
      mode: "local",
      storageFactory,
      transport,
      ...(options.delivery === undefined ? {} : { delivery: options.delivery }),
      ...(options.tracerFactory === undefined ? {} : { tracerFactory: options.tracerFactory }),
      ownsStorageFactory: options.ownsStorageFactory ?? options.storageFactory === undefined,
      ownsTransport: options.ownsTransport ?? options.transport === undefined,
      ownsDelivery: options.ownsDelivery ?? false,
      ownsTracerFactory: options.ownsTracerFactory ?? false,
    });
  }

  /** Create a production environment. Storage and transport must be supplied by the deployment. */
  static production(options: ServerEnvironmentProductionOptions): ServerEnvironment {
    const storageFactory = requireProductionFacility(options.storageFactory, "storageFactory");
    const transport = requireProductionFacility(options.transport, "transport");

    return new ServerEnvironment({
      mode: "production",
      storageFactory,
      transport,
      ...(options.delivery === undefined ? {} : { delivery: options.delivery }),
      ...(options.tracerFactory === undefined ? {} : { tracerFactory: options.tracerFactory }),
      ownsStorageFactory: options.ownsStorageFactory ?? false,
      ownsTransport: options.ownsTransport ?? false,
      ownsDelivery: options.ownsDelivery ?? false,
      ownsTracerFactory: options.ownsTracerFactory ?? false,
    });
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

interface ServerEnvironmentAccess {
  attach(
    environment: ServerEnvironment,
    options: EnvironmentAttachOptions,
  ): Promise<EnvironmentAttachmentHandle>;
  failedStartPending(environment: ServerEnvironment): boolean;
  retryFailedStart(environment: ServerEnvironment): Promise<void>;
  detach(environment: ServerEnvironment, attachment: EnvironmentAttachmentHandle): Promise<void>;
  retryDetach(
    environment: ServerEnvironment,
    attachment: EnvironmentAttachmentHandle,
  ): Promise<void>;
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
    testAttachmentsInstallable.delete(environment);
    const attachments = environmentAttachments.get(environment);
    if (attachments === undefined) {
      throw new TypeError("Failed-start observation requires a ServerEnvironment instance.");
    }
    return attachments.failedStartPending;
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

function ownedEnvironmentCloseables(
  options: ServerEnvironmentConstructorOptions,
): readonly unknown[] {
  return Object.freeze([
    ...(options.ownsDelivery === true && options.delivery !== undefined ? [options.delivery] : []),
    ...(options.ownsTracerFactory === true && options.tracerFactory !== undefined
      ? [options.tracerFactory]
      : []),
    ...(options.ownsTransport === true ? [options.transport] : []),
    ...(options.ownsStorageFactory === true ? [options.storageFactory] : []),
  ]);
}

function requireProductionFacility<T>(facility: T | undefined, name: string): T {
  if (facility === undefined || facility === null) {
    throw new Error(`Production ServerEnvironment requires ${name}.`);
  }
  return facility;
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
