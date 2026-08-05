import type { UnaryForwarder } from "./index.js";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { ErrorSchema } from "@spine-event-engine/proto";
import { ResponseSchema } from "@spine-event-engine/proto";
import { SubscriptionSchema, SubscriptionUpdateSchema } from "@spine-event-engine/proto/client";
import type {
  BackendSubscriptionEnvelope,
  SubscriptionCreator,
  SubscriptionTopicWire,
  PublicSubscriptionWire,
  SubscriptionUpdateSink,
} from "../subscriptions/index.js";

const maximumChildren = 32;
const envelopeVersion = 1;
const defaultEnvelopeBytes = 1_048_576;

/**
 * Forwards each accepted unary request to one fixed backend in round-robin order.
 */
export class RoundRobinUnaryForwarder implements UnaryForwarder {
  readonly #children: readonly UnaryForwarder[];
  #next = 0;

  /**
   * Creates a bounded fixed backend selector.
   *
   * @param children Supplies the ordered backend forwarders.
   */
  constructor(children: readonly UnaryForwarder[]) {
    FanInValues.children(children);
    this.#children = [...children];
  }

  /**
   * Returns the selected backend response for one authorized request.
   *
   * @param request Supplies the authorized request.
   * @returns Resolves to the selected backend response.
   */
  forward(request: Parameters<UnaryForwarder["forward"]>[0]): Promise<Uint8Array> {
    const child = this.#children[this.#next];
    this.#next = (this.#next + 1) % this.#children.length;
    if (child === undefined) throw new Error("Gateway backend is absent.");
    return child.forward(request);
  }
}

/**
 * Fans subscription lifecycle operations across a fixed set of backend creators.
 */
export class FanInSubscriptionCreator implements SubscriptionCreator {
  readonly #children: readonly SubscriptionCreator[];
  readonly #maxEnvelopeBytes: number;

  /**
   * Creates a bounded fixed subscription fan-in.
   *
   * @param children Supplies the ordered backend creators.
   */
  constructor(
    children: readonly SubscriptionCreator[],
    maxEnvelopeBytes: number = defaultEnvelopeBytes,
  ) {
    FanInValues.children(children);
    if (!Number.isSafeInteger(maxEnvelopeBytes) || maxEnvelopeBytes < 2)
      throw new RangeError("Gateway backend envelope limit must be a safe integer of at least 2.");
    this.#children = [...children];
    this.#maxEnvelopeBytes = maxEnvelopeBytes;
  }

  /**
   * Creates all child subscriptions and returns one opaque aggregate envelope.
   *
   * @param request Supplies the copied subscription topic.
   * @param signal Cancels creation.
   * @returns Returns the aggregate backend envelope.
   */
  async subscribe(
    request: SubscriptionTopicWire,
    signal: AbortSignal,
  ): Promise<BackendSubscriptionEnvelope> {
    const created: BackendSubscriptionEnvelope[] = [];
    try {
      for (const child of this.#children) created.push(await child.subscribe(request, signal));
      return {
        kind: "backend-subscription-envelope",
        bytes: FanInValues.encode(created, this.#maxEnvelopeBytes),
      };
    } catch (error) {
      await Promise.allSettled(
        created.map((backend, index) =>
          FanInValues.child(this.#children, index).dispose(backend, new AbortController().signal),
        ),
      );
      throw error;
    } finally {
      for (const backend of created) backend.bytes.fill(0);
    }
  }

  /**
   * Activates all child subscriptions and merges their updates into the supplied sink.
   *
   * @param request Supplies the public wire, aggregate envelope, and update sink.
   * @param signal Cancels activation.
   * @returns Completes when all child streams end.
   */
  async activate(
    request: {
      readonly wire: PublicSubscriptionWire;
      readonly backend: BackendSubscriptionEnvelope;
      readonly updates: SubscriptionUpdateSink;
    },
    signal: AbortSignal,
  ): Promise<void> {
    const children = FanInValues.decode(request.backend.bytes);
    let active = children.length;
    try {
      await Promise.all(
        children.map(async (backend, index) => {
          try {
            await FanInValues.child(this.#children, index).activate(
              { wire: request.wire, backend, updates: request.updates },
              signal,
            );
          } catch {
            // A child loss is represented by the generic notice below while healthy children continue.
          } finally {
            active--;
            if (active > 0 && !signal.aborted)
              await FanInValues.lossNotice(request.wire, request.updates);
          }
        }),
      );
    } finally {
      for (const backend of children) backend.bytes.fill(0);
    }
  }

  /**
   * Cancels every child subscription.
   *
   * @param request Supplies the public wire and aggregate envelope.
   * @param signal Cancels the operation.
   * @returns Completes after all cancellation attempts settle.
   */
  cancel(
    request: {
      readonly wire: PublicSubscriptionWire;
      readonly backend: BackendSubscriptionEnvelope;
    },
    signal: AbortSignal,
  ): Promise<void> {
    return this.#all(request.backend, (child, backend) =>
      child.cancel({ wire: request.wire, backend }, signal),
    );
  }

  /**
   * Returns after disposing every child subscription represented by the aggregate envelope.
   *
   * @param backend Supplies the aggregate envelope.
   * @param signal Cancels disposal.
   * @returns Resolves after all disposal attempts settle.
   */
  dispose(backend: BackendSubscriptionEnvelope, signal: AbortSignal): Promise<void> {
    return this.#all(backend, (child, childBackend) => child.dispose(childBackend, signal));
  }

  async #all(
    envelope: BackendSubscriptionEnvelope,
    operation: (child: SubscriptionCreator, backend: BackendSubscriptionEnvelope) => Promise<void>,
  ): Promise<void> {
    const children = FanInValues.decode(envelope.bytes);
    try {
      const settled = await Promise.allSettled(
        children.map((backend, index) =>
          operation(FanInValues.child(this.#children, index), backend),
        ),
      );
      const failures: unknown[] = [];
      for (const result of settled) if (result.status === "rejected") failures.push(result.reason);
      if (failures.length > 0)
        throw new AggregateError(failures, "Subscription fan-in operation failed.");
    } finally {
      for (const backend of children) backend.bytes.fill(0);
    }
  }
}

const FanInValues = Object.freeze({
  children(children: readonly unknown[]): void {
    if (children.length < 1 || children.length > maximumChildren)
      throw new RangeError("Gateway backends must contain between 1 and 32 children.");
  },
  encode(children: readonly BackendSubscriptionEnvelope[], maxBytes: number): Uint8Array {
    FanInValues.children(children);
    let size = 2;
    for (const child of children) {
      if (child.bytes.byteLength > maxBytes - size - 4)
        throw new Error("backend-envelope-too-large");
      size += 4 + child.bytes.byteLength;
    }
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    view.setUint8(0, envelopeVersion);
    view.setUint8(1, children.length);
    let offset = 2;
    for (const child of children) {
      view.setUint32(offset, child.bytes.byteLength);
      offset += 4;
      bytes.set(child.bytes, offset);
      offset += child.bytes.byteLength;
    }
    return bytes;
  },
  decode(bytes: Uint8Array): BackendSubscriptionEnvelope[] {
    if (bytes.byteLength < 2 || bytes[0] !== envelopeVersion)
      throw new Error("Invalid subscription fan-in envelope.");
    const count = bytes.at(1);
    if (count === undefined) throw new Error("Invalid subscription fan-in envelope.");
    FanInValues.children(Array.from({ length: count }));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const result: BackendSubscriptionEnvelope[] = [];
    let offset = 2;
    for (let index = 0; index < count; index++) {
      if (offset + 4 > bytes.byteLength) throw new Error("Invalid subscription fan-in envelope.");
      const length = view.getUint32(offset);
      offset += 4;
      if (offset + length > bytes.byteLength)
        throw new Error("Invalid subscription fan-in envelope.");
      result.push({
        kind: "backend-subscription-envelope",
        bytes: bytes.slice(offset, offset + length),
      });
      offset += length;
    }
    if (offset !== bytes.byteLength) throw new Error("Invalid subscription fan-in envelope.");
    return result;
  },
  async lossNotice(wire: PublicSubscriptionWire, updates: SubscriptionUpdateSink): Promise<void> {
    const subscription = fromBinary(SubscriptionSchema, wire.bytes);
    await updates({
      kind: "subscription-update",
      bytes: toBinary(
        SubscriptionUpdateSchema,
        create(SubscriptionUpdateSchema, {
          subscription,
          response: create(ResponseSchema, {
            status: {
              status: {
                case: "error",
                value: create(ErrorSchema, { type: "backend-unavailable" }),
              },
            },
          }),
        }),
      ),
    });
  },
  child<T>(children: readonly T[], index: number): T {
    const child = children[index];
    if (child === undefined) throw new Error("Subscription fan-in child is absent.");
    return child;
  },
});
