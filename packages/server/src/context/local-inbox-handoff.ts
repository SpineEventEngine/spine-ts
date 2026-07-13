import { Delivery, type DeliveryEndpointMessage } from "../delivery/delivery.js";
import type { InboxMessage } from "../delivery/inbox.js";
import { ShardIndex } from "../delivery/shard-index.js";

/** @internal Delivery labels backed by current worker endpoints. */
export type SupportedDeliveryLabel = DeliveryEndpointMessage["label"];

/** @internal One configured endpoint and shard obligation. */
export interface DeliveryEndpoint {
  readonly label: SupportedDeliveryLabel;
  readonly targetTypeUrl: string;
  readonly shard: ShardIndex;
}

/** @internal Post-persist readiness identity for one configured obligation. */
export interface DeliveryReady extends DeliveryEndpoint {
  readonly tenantId?: string;
}

/** @internal Synchronous post-persist readiness callback. */
export type OnDeliveryReady = (ready: DeliveryReady) => unknown;

/** @internal Mutable single-route readiness seam shared by context handoffs. */
export class DeliveryReadiness {
  #onReady: OnDeliveryReady;
  readonly #active = new Set<Promise<void>>();
  #mode: "direct" | "transition" | "routed" | "failed" = "direct";
  #configured = new Map<string, DeliveryReady>();
  #buffered = new Map<string, DeliveryReady>();
  #invalidTransition = false;

  constructor(onReady: OnDeliveryReady = () => undefined) {
    this.#onReady = onReady;
  }

  onReady(onReady: OnDeliveryReady): () => void {
    if (this.#mode === "routed") {
      return () => undefined;
    }
    this.#onReady = onReady;
    return () => {
      if (this.#onReady === onReady) {
        this.#onReady = () => undefined;
      }
    };
  }

  claim(ready?: DeliveryReady): DeliveryHandoff {
    if (this.#mode === "direct") {
      const handoff = this.#directHandoff();
      if (ready !== undefined) {
        this.#notify(ready);
      }
      return handoff;
    }
    if (ready !== undefined) {
      if (this.#mode === "transition") {
        const key = readyKey(ready);
        if (this.#configured.has(key)) {
          this.#buffered.set(key, cloneReady(ready));
        } else {
          this.#invalidTransition = true;
        }
      } else if (this.#mode === "routed") {
        this.#notify(ready);
      }
    }
    return settledHandoff;
  }

  transition(
    scopes: readonly DeliveryReady[],
    onReady: OnDeliveryReady,
    options: { readonly allowEmpty?: boolean } = {},
  ): Promise<void> {
    if (this.#mode !== "direct" && this.#mode !== "failed") {
      return Promise.reject(new Error("Delivery readiness ownership is already transferred."));
    }
    let configured: Map<string, DeliveryReady>;
    try {
      configured = configuredScopes(scopes, options.allowEmpty === true);
    } catch (error) {
      return Promise.resolve().then(() => {
        throw error;
      });
    }
    this.#configured = configured;
    this.#buffered.clear();
    this.#invalidTransition = false;
    this.#mode = "transition";
    const admitted = [...this.#active];
    return Promise.allSettled(admitted).then(() => {
      if (this.#invalidTransition) {
        this.#buffered.clear();
        this.#mode = "failed";
        throw new Error("Delivery readiness transition received an unconfigured scope.");
      }
      this.#onReady = onReady;
      this.#mode = "routed";
      for (const ready of this.#buffered.values()) {
        this.#notify(ready);
      }
      this.#buffered.clear();
    });
  }

  #directHandoff(): DeliveryHandoff {
    const gate = Promise.withResolvers<undefined>();
    this.#active.add(gate.promise);
    let abandoned = false;
    let completion: Promise<void> | undefined;
    const finish = (): void => {
      gate.resolve(undefined);
      this.#active.delete(gate.promise);
    };
    return Object.freeze({
      complete: (onDrain: () => Promise<void>) => {
        if (completion !== undefined) {
          return completion;
        }
        if (abandoned) {
          return settled;
        }
        const shared = Promise.withResolvers<undefined>();
        completion = shared.promise;
        void completion.then(finish, finish);
        try {
          void Promise.resolve(onDrain()).then(() => {
            shared.resolve(undefined);
          }, shared.reject);
        } catch (error) {
          shared.reject(error);
        }
        return completion;
      },
      abandon: () => {
        if (completion !== undefined || abandoned) {
          return;
        }
        abandoned = true;
        finish();
      },
    });
  }

  #notify(ready: DeliveryReady): void {
    try {
      const result = Reflect.apply(this.#onReady, undefined, [ready]);
      if (isPromiseLike(result)) {
        void Promise.resolve(result).catch(() => undefined);
      }
    } catch {
      // Readiness observation cannot alter durable receive or exact-drain outcomes.
    }
  }
}

/** @internal One post-persist ownership claim made before direct admission can close. */
export interface DeliveryHandoff {
  complete(onDrain: () => Promise<void>): Promise<void>;
  abandon(): void;
}

const settled = Promise.resolve();
const settledHandoff: DeliveryHandoff = Object.freeze({
  complete: () => settled,
  abandon: () => undefined,
});

export function deliveryReady(endpoint: DeliveryEndpoint, tenantId?: string): DeliveryReady {
  return Object.freeze({
    ...(tenantId === undefined ? {} : { tenantId }),
    label: endpoint.label,
    targetTypeUrl: endpoint.targetTypeUrl,
    shard: new ShardIndex(endpoint.shard.index, endpoint.shard.ofTotal),
  });
}

function configuredScopes(
  scopes: readonly DeliveryReady[],
  allowEmpty: boolean,
): Map<string, DeliveryReady> {
  const configured = new Map<string, DeliveryReady>();
  for (const scope of scopes) {
    configured.set(readyKey(scope), cloneReady(scope));
  }
  if (configured.size === 0 && !allowEmpty) {
    throw new Error("Delivery readiness transition requires configured scopes.");
  }
  return configured;
}

function readyKey(ready: DeliveryReady): string {
  return JSON.stringify([
    ready.tenantId ?? "",
    ready.label,
    ready.targetTypeUrl,
    ready.shard.index,
    ready.shard.ofTotal,
  ]);
}

function cloneReady(ready: DeliveryReady): DeliveryReady {
  return deliveryReady(ready, ready.tenantId);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    return false;
  }
  return "then" in value && typeof value.then === "function";
}

const drainLimit = 8;

export async function coordinateLocalInboxHandoff(options: {
  readonly handoffs: Map<string, Promise<InboxMessage>>;
  readonly key: string;
  readonly onHandoff: () => Promise<InboxMessage>;
}): Promise<InboxMessage> {
  const inFlightHandoff = options.handoffs.get(options.key);

  if (inFlightHandoff !== undefined) {
    return await inFlightHandoff;
  }

  const handoff = options.onHandoff();
  options.handoffs.set(options.key, handoff);
  try {
    return await handoff;
  } finally {
    if (options.handoffs.get(options.key) === handoff) {
      options.handoffs.delete(options.key);
    }
  }
}

export async function drainLocalInboxMessage(options: LocalInboxDrainOptions): Promise<void> {
  await runLocalInboxDrain(options);
}

async function runLocalInboxDrain(options: LocalInboxDrainOptions): Promise<void> {
  const {
    delivery,
    received,
    node,
    onReplay,
    replayFailureMessage,
    skippedMessage,
    unfinishedMessage,
  } = options;

  for (let attempt = 0; attempt < drainLimit; attempt += 1) {
    const run = await delivery.drainMessage(received, {
      node,
      onMessage: onReplay,
    });
    const target = await delivery.inbox.readMessage(received.id);

    if (target?.status === "DELIVERED") {
      return;
    }

    const failure = run.failures.find(({ message }) => sameMessageId(message.id, received.id));

    if (failure !== undefined) {
      throw failure.error instanceof Error
        ? failure.error
        : new Error(replayFailureMessage, { cause: failure.error });
    }
    if (run.status === "SKIPPED") {
      throw new Error(skippedMessage);
    }
    if (run.accepted === 0 && run.delivered === 0 && run.failed === 0) {
      break;
    }
  }

  throw new Error(unfinishedMessage);
}

export interface LocalInboxDrainOptions {
  readonly delivery: Delivery;
  readonly received: InboxMessage;
  readonly node: string;
  readonly onReplay: (message: InboxMessage) => Promise<void> | void;
  readonly replayFailureMessage: string;
  readonly skippedMessage: string;
  readonly unfinishedMessage: string;
}

export interface LocalInboxKeyInput {
  readonly inboxId: {
    readonly targetId: string;
    readonly targetTypeUrl: string;
  };
  readonly signalId: string;
  readonly label: InboxMessage["label"];
  readonly shard: InboxMessage["shard"];
}

export function localInboxHandoffKey(input: LocalInboxKeyInput, deliveryTenantId?: string): string {
  return JSON.stringify([
    deliveryTenantId ?? "",
    input.label,
    input.signalId,
    input.inboxId.targetTypeUrl,
    input.inboxId.targetId,
    input.shard.index,
    input.shard.ofTotal,
  ]);
}

function sameMessageId(
  left: {
    readonly value: string;
    readonly shard: { readonly index: number; readonly ofTotal: number };
  },
  right: {
    readonly value: string;
    readonly shard: { readonly index: number; readonly ofTotal: number };
  },
): boolean {
  return (
    left.value === right.value &&
    left.shard.index === right.shard.index &&
    left.shard.ofTotal === right.shard.ofTotal
  );
}

export function deliveryEndpoint(input: {
  readonly label: SupportedDeliveryLabel;
  readonly inboxId: { readonly targetTypeUrl: string };
  readonly shard: ShardIndex;
}): DeliveryEndpoint {
  return Object.freeze({
    label: input.label,
    targetTypeUrl: input.inboxId.targetTypeUrl,
    shard: new ShardIndex(input.shard.index, input.shard.ofTotal),
  });
}

export function configuredDeliveryEndpoint(
  message: InboxMessage,
  endpoints: readonly DeliveryEndpoint[],
): DeliveryEndpoint | undefined {
  if (message.status !== "TO_DELIVER") {
    return undefined;
  }
  return endpoints.find(
    (endpoint) =>
      endpoint.targetTypeUrl === message.inboxId.targetTypeUrl &&
      endpoint.label === message.label &&
      endpoint.shard.key() === message.shard.key(),
  );
}
