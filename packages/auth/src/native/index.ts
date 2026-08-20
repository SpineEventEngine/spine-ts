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

import { clone, create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  Code,
  ConnectError,
  createClient,
  type HandlerContext,
  type ServiceImpl,
  type Transport,
} from "@connectrpc/connect";
import {
  CommandService,
  QueryService,
  type Query,
  type QueryResponse,
  SubscriptionSchema,
  SubscriptionService,
  SubscriptionUpdateSchema,
  TopicSchema,
  type Subscription,
  type SubscriptionUpdate,
} from "@spine-event-engine/proto/client";
import { AuthenticationService } from "@spine-event-engine/proto/auth";
import type { Command } from "@spine-event-engine/proto";
import type { UnaryForwarder, UnaryGateway, UnaryGatewayResult } from "../gateway/index.js";
import type { RequestCredential, TransportRequestContext } from "../index.js";
import type {
  BackendSubscriptionEnvelope,
  PublicSubscriptionWire,
  SubscriptionAbortSignal,
  SubscriptionCreator,
  SubscriptionUpdateSink,
  SubscriptionUpdateWire,
  SubscriptionGateway,
  SubscriptionGatewayResult,
} from "../subscriptions/index.js";

/**
 * Finite public-stream bounds. Defaults are 64 messages and 1,048,576 bytes;
 * supplied bounds must be positive safe integers.
 */
export interface SubscriptionRelayLimits {
  // prettier-ignore

  /**
   * Limits the number of queued updates.
   */
  readonly maxMessages?: number;

  /**
   * Limits the total queued update bytes.
   */
  readonly maxBytes?: number;
}

const relayDefaults: Required<SubscriptionRelayLimits> = {
  maxMessages: 64,
  maxBytes: 1_048_576,
};

/**
 * A bounded asynchronous FIFO relay between one private backend stream and one public Connect stream.
 */
export class SubscriptionUpdateRelay implements AsyncIterable<SubscriptionUpdate> {
  readonly #limits: Required<SubscriptionRelayLimits>;
  readonly #queue: Uint8Array[] = [];
  readonly #waiters: {
    readonly resolve: (result: IteratorResult<SubscriptionUpdate>) => void;
    readonly reject: (reason: unknown) => void;
  }[] = [];
  #bytes = 0;
  #terminal: unknown;
  #closed = false;

  /**
   * Creates a bounded FIFO relay.
   * @param limits The optional message and byte bounds.
   */
  constructor(limits: SubscriptionRelayLimits = {}) {
    this.#limits = NativeGatewayValues.relayLimits(limits);
  }

  /**
   * Copies and validates an update before FIFO admission. Count precedes bytes;
   * either bound rejects with `ResourceExhausted`.
   * @param update The update bytes to admit.
   * @returns Completes after the update is admitted or rejected.
   */
  push(update: SubscriptionUpdateWire): Promise<void> {
    try {
      if (this.#closed) throw NativeGatewayValues.terminalError(this.#terminal);
      const nextMessages = this.#queue.length + 1;
      if (nextMessages > this.#limits.maxMessages)
        return this.#failOverflow("message", this.#limits.maxMessages, nextMessages);
      const bytes = update.bytes.slice();
      let decoded: SubscriptionUpdate;
      try {
        decoded = fromBinary(SubscriptionUpdateSchema, bytes);
      } catch (error) {
        bytes.fill(0);
        this.#finish(error);
        throw error;
      }
      const nextBytes = this.#bytes + bytes.byteLength;
      if (nextBytes > this.#limits.maxBytes) {
        bytes.fill(0);
        return this.#failOverflow("byte", this.#limits.maxBytes, nextBytes);
      }
      const waiter = this.#waiters.shift();
      if (waiter !== undefined) {
        waiter.resolve({ done: false, value: clone(SubscriptionUpdateSchema, decoded) });
        bytes.fill(0);
        return Promise.resolve();
      }
      this.#bytes = nextBytes;
      this.#queue.push(bytes);
      return Promise.resolve();
    } catch (error) {
      return NativeRelayValues.rejectedRelayPromise(error);
    }
  }

  /**
   * Starts graceful FIFO drain; later cancellation or failure supersedes it and purges queued bytes.
   */
  close(): void {
    this.#finish();
  }

  /**
   * Throws queued and future consumers, purging bytes.
   * @param reason The terminal failure reason.
   */
  fail(reason: unknown): void {
    this.#finish(reason);
  }

  /**
   * Returns the public iterator; `return()` cancels it and purges queued bytes, while `throw()` fails it.
   * @returns The single public update iterator.
   */
  [Symbol.asyncIterator](): AsyncIterator<SubscriptionUpdate> {
    return {
      next: () => this.#next(),
      return: () => {
        this.#finish(new ConnectError("subscription stream cancelled", Code.Canceled));
        return Promise.resolve({ done: true, value: undefined });
      },
      throw: (reason) => {
        this.#finish(reason);
        return NativeRelayValues.rejectedRelayPromise(reason);
      },
    };
  }

  async #next(): Promise<IteratorResult<SubscriptionUpdate>> {
    const bytes = this.#queue.shift();
    if (bytes !== undefined) {
      this.#bytes -= bytes.byteLength;
      try {
        return {
          done: false,
          value: clone(SubscriptionUpdateSchema, fromBinary(SubscriptionUpdateSchema, bytes)),
        };
      } finally {
        bytes.fill(0);
      }
    }
    if (this.#closed) {
      if (this.#terminal !== undefined) throw NativeGatewayValues.terminalError(this.#terminal);
      return { done: true, value: undefined };
    }
    return new Promise((resolve, reject) => this.#waiters.push({ resolve, reject }));
  }

  #failOverflow(dimension: "message" | "byte", limit: number, observed: number): never {
    const error = new ConnectError(
      `subscription relay ${dimension} limit ${String(limit)} exceeded by ${String(observed)}`,
      Code.ResourceExhausted,
    );
    this.#finish(error);
    throw error;
  }

  #finish(reason?: unknown): void {
    if (this.#closed) {
      if (this.#terminal !== undefined || reason === undefined) return;
      this.#terminal = reason;
      for (const bytes of this.#queue) bytes.fill(0);
      this.#queue.length = 0;
      this.#bytes = 0;
      return;
    }
    this.#closed = true;
    this.#terminal = reason;
    if (reason !== undefined) {
      for (const bytes of this.#queue) bytes.fill(0);
      this.#queue.length = 0;
      this.#bytes = 0;
    }
    const waiters = this.#waiters.splice(0);
    for (const waiter of waiters) {
      if (reason === undefined) waiter.resolve({ done: true, value: undefined });
      else waiter.reject(reason);
    }
  }
}

/**
 * Creates completed native-relay rejection values.
 */
const NativeRelayValues = Object.freeze({
  rejectedRelayPromise(reason: unknown): Promise<never> {
    return Promise.resolve().then(() => {
      throw reason;
    });
  },
});

/**
 * Native Connect adapter. Post/Read use their matching Command/Query descriptors;
 * Subscribe/Activate/Cancel/Dispose use the shared Subscription descriptors.
 * Every call receives only an admitted AbortSignal, never browser credentials or facts.
 */
export class NativeSubscriptionCreator implements SubscriptionCreator, UnaryForwarder {
  readonly #transport: Transport;

  /**
   * Creates a native adapter over one Connect transport.
   * @param transport The native Connect transport.
   */
  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /**
   * Sends an admitted Post or Read envelope through its matching native descriptor.
   * @param request The admitted unary request envelope.
   * @returns The encoded native response.
   */
  async forward(request: {
    readonly service: string;
    readonly method: string;
    readonly value: Uint8Array;
    readonly signal?: AbortSignal;
  }): Promise<Uint8Array> {
    if (request.service === "spine.client.CommandService" && request.method === "Post")
      return toBinary(
        CommandService.method.post.output,
        await createClient(CommandService, this.#transport).post(
          fromBinary(CommandService.method.post.input, request.value),
          ...(request.signal === undefined ? [] : [{ signal: request.signal }]),
        ),
      );
    if (request.service === "spine.client.QueryService" && request.method === "Read")
      return toBinary(
        QueryService.method.read.output,
        await createClient(QueryService, this.#transport).read(
          fromBinary(QueryService.method.read.input, request.value),
          ...(request.signal === undefined ? [] : [{ signal: request.signal }]),
        ),
      );
    throw new ConnectError("unsupported native unary operation", Code.Unimplemented);
  }

  /**
   * Creates a native subscription with the supplied admitted cancellation signal.
   * @param request The admitted canonical subscription definition.
   * @param signal The admitted cancellation signal.
   * @returns The private backend subscription envelope.
   */
  async subscribe(
    request: PublicSubscriptionWire,
    signal: SubscriptionAbortSignal,
  ): Promise<BackendSubscriptionEnvelope> {
    const result = await createClient(SubscriptionService, this.#transport).subscribe(
      fromBinary(SubscriptionSchema, request.bytes).topic ?? create(TopicSchema),
      { signal },
    );
    return { kind: "backend-subscription-envelope", bytes: toBinary(SubscriptionSchema, result) };
  }

  /**
   * Streams native Activate updates through the supplied asynchronous public-update sink.
   * @param request The private native subscription envelope and update sink.
   * @param signal The admitted cancellation signal.
   * @returns Completes after native activation ends.
   */
  async activate(
    request: {
      readonly wire: BackendSubscriptionEnvelope;
      readonly updates: SubscriptionUpdateSink;
    },
    signal: SubscriptionAbortSignal,
  ): Promise<void> {
    const subscription = fromBinary(SubscriptionSchema, request.wire.bytes);
    for await (const update of createClient(SubscriptionService, this.#transport).activate(
      subscription,
      { signal },
    ))
      await request.updates({
        kind: "subscription-update",
        bytes: toBinary(SubscriptionUpdateSchema, update),
      });
  }

  /**
   * Cancels the native subscription represented by the canonical definition.
   * @param request The canonical subscription definition.
   * @param signal The admitted cancellation signal.
   * @returns Completes after native cancellation ends.
   */
  async cancel(
    request: { readonly wire: PublicSubscriptionWire },
    signal: SubscriptionAbortSignal,
  ): Promise<void> {
    await createClient(SubscriptionService, this.#transport).cancel(
      fromBinary(SubscriptionSchema, request.wire.bytes),
      { signal },
    );
  }

  /**
   * Performs mandatory native cancellation/disposal compensation for a private envelope.
   * @param envelope The private backend subscription envelope.
   * @param signal The admitted cancellation signal.
   * @returns Completes after native disposal ends.
   */
  async dispose(
    envelope: BackendSubscriptionEnvelope,
    signal: SubscriptionAbortSignal,
  ): Promise<void> {
    await createClient(SubscriptionService, this.#transport).cancel(
      fromBinary(SubscriptionSchema, envelope.bytes),
      { signal },
    );
  }
}

/**
 * Application-owned extractor of browser credentials and allowlisted request facts from Connect context.
 */
export interface NativeGatewayRequestContext {
  // prettier-ignore

  /**
   * Reads credentials for the gateway only; they are never forwarded to native services.
   * @param context The incoming Connect handler context.
   * @returns The extracted request credential.
   */
  credential(context: HandlerContext): RequestCredential | undefined;

  /**
   * Reads the allowlisted authorization and diagnostic transport view for the gateway only.
   * @param context The incoming Connect handler context.
   * @returns The allowed transport facts.
   */
  transport(context: HandlerContext): TransportRequestContext;
}

/**
 * B4 Connect services. Each handler delegates to the reviewed B2/B3 gateway boundary.
 */
export interface NativeGatewayServices {
  // prettier-ignore

  /**
   * Connect AuthenticationService implementation for informational context resolution.
   */
  readonly authentication: ServiceImpl<typeof AuthenticationService>;

  /**
   * Connect CommandService implementation whose Post handler delegates to the B2 unary gateway.
   */
  readonly command: ServiceImpl<typeof CommandService>;

  /**
   * Connect QueryService implementation whose Read handler delegates to the B2 unary gateway.
   */
  readonly query: ServiceImpl<typeof QueryService>;

  /**
   * Connect SubscriptionService implementation whose handlers delegate to the B3 subscription gateway.
   */
  readonly subscription: ServiceImpl<typeof SubscriptionService>;
}

/**
 * Named options for {@link createNativeGatewayServices}.
 */
export interface NativeGatewayServicesOptions {
  // prettier-ignore

  /**
   * B2 Post/Read boundary.
   */
  readonly unary: UnaryGateway;

  /**
   * B3 Subscribe/Activate/Cancel boundary.
   */
  readonly subscriptions: SubscriptionGateway;

  /**
   * Application-owned context extractor.
   */
  readonly requests: NativeGatewayRequestContext;

  /**
   * Optional public relay bounds.
   */
  readonly relay?: SubscriptionRelayLimits;
}

/**
 * Creates native handlers without exposing private envelopes.
 *
 * Unauthenticated requests map to `Unauthenticated`; forbidden or denied requests to
 * `PermissionDenied`; request/capacity limits to `ResourceExhausted`; busy bindings to `Aborted`;
 * and unknown operations to `Unimplemented`. Malformed, stale-context, backend-envelope, and other
 * validation rejections map to `InvalidArgument`. Terminal context/iterator paths abort native
 * work. Natural completion drains FIFO updates, whereas failure or iterator cancellation purges
 * them.
 * @param options The unary, subscription, context, and relay dependencies.
 * @returns The native Connect service implementations.
 */
export function createNativeGatewayServices(
  options: NativeGatewayServicesOptions,
): NativeGatewayServices {
  return {
    authentication: {
      resolveContext: async (request, context) =>
        NativeGatewayValues.resolveContext(options, request, context),
    },
    command: {
      post: async (request, context) =>
        NativeGatewayValues.commandResponse(options, request, context),
    },
    query: {
      read: async (request, context) =>
        NativeGatewayValues.queryResponse(options, request, context),
    },
    subscription: {
      subscribe: async (request, context) => {
        const result = await options.subscriptions.handle(
          NativeGatewayValues.subscriptionRequest(
            "Subscribe",
            toBinary(TopicSchema, request),
            context,
            options.requests,
          ),
        );
        if (result.kind !== "subscribed") throw NativeGatewayValues.gatewayResultError(result);
        return fromBinary(SubscriptionSchema, result.wire.bytes);
      },
      activate: (request, context) => NativeGatewayValues.activate(options, request, context),
      cancel: async (request, context) => {
        const result = await options.subscriptions.handle(
          NativeGatewayValues.subscriptionRequest(
            "Cancel",
            toBinary(SubscriptionSchema, request),
            context,
            options.requests,
          ),
        );
        if (result.kind !== "cancelled") throw NativeGatewayValues.gatewayResultError(result);
        return create(SubscriptionService.method.cancel.output);
      },
    },
  };
}

/**
 * Converts native Connect gateway inputs, responses, and errors.
 */
const NativeGatewayValues = Object.freeze({
  async resolveContext(
    options: NativeGatewayServicesOptions,
    request: Parameters<ServiceImpl<typeof AuthenticationService>["resolveContext"]>[0],
    context: HandlerContext,
  ): Promise<
    ReturnType<typeof fromBinary<typeof AuthenticationService.method.resolveContext.output>>
  > {
    const result = await options.unary.handle({
      service: "spine.auth.AuthenticationService",
      method: "ResolveContext",
      value: toBinary(AuthenticationService.method.resolveContext.input, request),
      credential: options.requests.credential(context),
      transport: options.requests.transport(context),
      signal: context.signal,
    });
    if (result.kind === "rejected") throw NativeGatewayValues.unaryError(result);
    if (result.kind !== "resolved")
      throw new ConnectError("gateway forwarded ResolveContext unexpectedly", Code.Internal);
    return fromBinary(AuthenticationService.method.resolveContext.output, result.value);
  },

  async commandResponse(
    options: NativeGatewayServicesOptions,
    request: Command,
    context: HandlerContext,
  ): Promise<ReturnType<typeof fromBinary<typeof CommandService.method.post.output>>> {
    const result = await options.unary.handle({
      service: "spine.client.CommandService",
      method: "Post",
      value: toBinary(CommandService.method.post.input, request),
      credential: options.requests.credential(context),
      transport: options.requests.transport(context),
      signal: context.signal,
    });
    if (result.kind === "rejected") throw NativeGatewayValues.unaryError(result);
    return fromBinary(CommandService.method.post.output, result.value);
  },

  async queryResponse(
    options: NativeGatewayServicesOptions,
    request: Query,
    context: HandlerContext,
  ): Promise<QueryResponse> {
    const result = await options.unary.handle({
      service: "spine.client.QueryService",
      method: "Read",
      value: toBinary(QueryService.method.read.input, request),
      credential: options.requests.credential(context),
      transport: options.requests.transport(context),
      signal: context.signal,
    });
    if (result.kind === "rejected") throw NativeGatewayValues.unaryError(result);
    return fromBinary(QueryService.method.read.output, result.value);
  },

  activate(
    options: NativeGatewayServicesOptions,
    request: Subscription,
    context: HandlerContext,
  ): AsyncIterable<SubscriptionUpdate> {
    const relay = new SubscriptionUpdateRelay(options.relay);
    const controller = new AbortController();
    let closed = false;
    let started = false;
    let cancellation: Promise<void> | undefined;
    const cancel = () => {
      cancellation ??= options.subscriptions
        .handle(
          NativeGatewayValues.subscriptionRequest(
            "Cancel",
            toBinary(SubscriptionSchema, request),
            context,
            options.requests,
          ),
        )
        .then(
          () => undefined,
          () => undefined,
        );
      return cancellation;
    };
    const close = (reason: unknown, abort: boolean): void => {
      if (closed) {
        if (reason === undefined) return;
        context.signal.removeEventListener("abort", onAbort);
        if (abort) controller.abort();
        relay.fail(reason);
        return;
      }
      closed = true;
      if (abort) controller.abort();
      if (reason === undefined) relay.close();
      else {
        context.signal.removeEventListener("abort", onAbort);
        relay.fail(reason);
      }
    };
    const onAbort = () => {
      close(new ConnectError("subscription stream cancelled", Code.Canceled), true);
      if (started) void cancel();
    };
    context.signal.addEventListener("abort", onAbort, { once: true });
    if (context.signal.aborted) {
      onAbort();
      return NativeGatewayValues.activationStream(relay, (reason) => {
        close(reason, true);
      });
    }
    started = true;
    void options.subscriptions
      .handle({
        ...NativeGatewayValues.subscriptionRequest(
          "Activate",
          toBinary(SubscriptionSchema, request),
          context,
          options.requests,
        ),
        updates: (update) => relay.push(update),
        signal: controller.signal,
      })
      .then((result) => {
        if (result.kind !== "activated")
          close(NativeGatewayValues.gatewayResultError(result), true);
        else close(undefined, false);
      })
      .catch((error: unknown) => {
        close(error, true);
      });
    return NativeGatewayValues.activationStream(relay, (reason) => {
      close(reason, true);
    });
  },

  activationStream(
    relay: SubscriptionUpdateRelay,
    onClose: (reason: unknown) => void,
  ): AsyncIterable<SubscriptionUpdate> {
    return {
      [Symbol.asyncIterator](): AsyncIterator<SubscriptionUpdate> {
        const iterator = relay[Symbol.asyncIterator]();
        return {
          next: () => iterator.next(),
          return: () => {
            onClose(new ConnectError("subscription stream cancelled", Code.Canceled));
            return Promise.resolve({ done: true, value: undefined });
          },
          throw: (reason) => {
            onClose(reason);
            return NativeRelayValues.rejectedRelayPromise(reason);
          },
        };
      },
    };
  },

  subscriptionRequest(
    method: "Subscribe" | "Activate" | "Cancel",
    bytes: Uint8Array,
    context: HandlerContext,
    requests: NativeGatewayRequestContext,
  ) {
    return {
      service: "spine.client.SubscriptionService",
      method,
      wire:
        method === "Subscribe"
          ? { kind: "subscription-topic" as const, bytes }
          : { kind: "public-subscription" as const, bytes },
      credential: requests.credential(context),
      transport: requests.transport(context),
    };
  },

  unaryError(result: Extract<UnaryGatewayResult, { readonly kind: "rejected" }>): ConnectError {
    const code =
      result.reason === "unauthenticated"
        ? Code.Unauthenticated
        : result.reason === "forbidden"
          ? Code.PermissionDenied
          : result.reason === "request-too-large"
            ? Code.ResourceExhausted
            : result.reason === "unknown-operation"
              ? Code.Unimplemented
              : Code.InvalidArgument;
    return new ConnectError(`gateway rejected ${result.reason}`, code);
  },

  gatewayResultError(result: SubscriptionGatewayResult): ConnectError {
    if (result.kind !== "rejected")
      return new ConnectError(
        "subscription gateway returned an unexpected operation result",
        Code.Internal,
      );
    const code =
      result.reason === "unauthenticated"
        ? Code.Unauthenticated
        : result.reason === "forbidden" || result.reason === "denied"
          ? Code.PermissionDenied
          : result.reason === "request-too-large"
            ? Code.ResourceExhausted
            : result.reason === "binding-busy"
              ? Code.Aborted
              : result.reason === "unknown-operation"
                ? Code.Unimplemented
                : Code.InvalidArgument;
    return new ConnectError(`gateway rejected ${result.reason}`, code);
  },

  relayLimits(input: SubscriptionRelayLimits): Required<SubscriptionRelayLimits> {
    const limits = { ...relayDefaults, ...input };
    for (const limit of Object.values(limits))
      if (!Number.isSafeInteger(limit) || limit <= 0)
        throw new RangeError("subscription relay limits must be positive safe integers");
    return limits;
  },

  terminalError(reason: unknown): Error {
    return reason instanceof Error
      ? reason
      : new ConnectError("subscription stream closed", Code.Canceled);
  },
});
