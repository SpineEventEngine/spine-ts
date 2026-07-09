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

import type { Delivery } from "../delivery/delivery.js";
import { RetryableCloseGroup } from "./retryable-close.js";

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
  /** Storage facility selected for server assembly and later builder integration. */
  readonly storageFactory?: StorageFactory;
  /** Local signal transport facility. */
  readonly transport?: SignalTransport;
  /** Optional delivery owner for durable delivery seams. */
  readonly delivery?: Delivery;
  /** Optional tracing factory placeholder for later tracing adapters. */
  readonly tracerFactory?: ServerEnvironmentCloseable;
}

/** Production environment options. Storage and transport are required. */
export interface ServerEnvironmentProductionOptions extends ServerEnvironmentOwnershipOptions {
  /** Durable storage facility selected for server assembly and later builder integration. */
  readonly storageFactory: StorageFactory;
  /** Signal transport facility supplied by the deployment. */
  readonly transport: SignalTransport;
  /** Optional delivery owner for durable delivery seams. */
  readonly delivery?: Delivery;
  /** Optional tracing factory placeholder for later tracing adapters. */
  readonly tracerFactory?: ServerEnvironmentCloseable;
}

interface ServerEnvironmentConstructorOptions extends ServerEnvironmentOwnershipOptions {
  readonly mode: ServerEnvironmentMode;
  readonly storageFactory: StorageFactory;
  readonly transport: SignalTransport;
  readonly delivery?: Delivery;
  readonly tracerFactory?: ServerEnvironmentCloseable;
}

/**
 * Explicit server runtime environment for storage, transport, delivery, and tracing facilities.
 *
 * This is deliberately a small object, not a process-wide singleton. Local
 * environments use in-memory storage and same-process transport defaults.
 * Production environments require caller-supplied storage and transport before
 * a server is assembled. Built contexts keep the storage factory they were
 * built with until a later builder integration wires contexts from an
 * environment.
 */
export class ServerEnvironment implements ServerEnvironmentCloseable {
  /** Environment deployment profile. */
  readonly mode: ServerEnvironmentMode;
  /** Storage facility selected for server assembly and later builder integration. */
  readonly storageFactory: StorageFactory;
  /** Transport facility selected for this environment. */
  readonly transport: SignalTransport;
  /** Optional delivery owner selected for this environment. */
  readonly delivery: Delivery | undefined;
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

  /** Close environment-owned facilities. Failed closes may be retried. */
  close(): Promise<void> {
    this.#close ??= this.#closeGroup.close().catch((error: unknown) => {
      this.#close = undefined;
      throw error;
    });
    return this.#close;
  }
}

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
  readonly #publishHandlers = new Map<
    string,
    Set<PublishTransportHandler<unknown, TransportSignalKind>>
  >();
  readonly #requestHandlers = new Map<string, RequestTransportHandler<unknown, unknown>>();
  #closed = false;

  async publish<Envelope, Kind extends TransportSignalKind>(
    operation: PublishTransportOperation<Envelope, Kind>,
  ): Promise<void> {
    this.#requireOpen();
    const handlers = this.#publishHandlers.get(operation.topic.routing.routingKey);

    if (handlers === undefined) {
      return;
    }

    await Promise.all([...handlers].map((handler) => handler(operation)));
  }

  async subscribe<Envelope, Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    handler: PublishTransportHandler<Envelope, Kind>,
  ): Promise<TransportSubscriptionHandle<Kind>> {
    this.#requireOpen();
    const key = subscription.topic.routing.routingKey;
    const handlers = this.#publishHandlers.get(key) ?? new Set();
    const stored = handler as PublishTransportHandler<unknown, TransportSignalKind>;

    handlers.add(stored);
    this.#publishHandlers.set(key, handlers);

    return new LocalTransportSubscriptionHandle(subscription, () => {
      handlers.delete(stored);
      if (handlers.size === 0) {
        this.#publishHandlers.delete(key);
      }
    });
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

    return (await handler(operation)) as ResponseEnvelope;
  }

  async respond<RequestEnvelope, ResponseEnvelope, Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    handler: RequestTransportHandler<RequestEnvelope, ResponseEnvelope, Kind>,
  ): Promise<TransportSubscriptionHandle<Kind>> {
    this.#requireOpen();
    const key = subscription.topic.routing.routingKey;

    if (this.#requestHandlers.has(key)) {
      throw new Error(`Local transport responder is already registered for "${key}".`);
    }

    const stored = handler as RequestTransportHandler<unknown, unknown>;
    this.#requestHandlers.set(key, stored);

    return new LocalTransportSubscriptionHandle(subscription, () => {
      this.#requestHandlers.delete(key);
    });
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
