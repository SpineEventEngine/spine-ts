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

import { clone, create, equals, fromBinary, toBinary } from "@bufbuild/protobuf";
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
  AppQuerySchema,
  type AppQuery,
  type AppQueryResponse,
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
import {
  ReaderForwarding,
  type ReaderProofIssuer,
} from "@spine-event-engine/core/spi/reader-forwarding";
import type { TrustedReaderContext } from "@spine-event-engine/core/spi/trusted-reader";
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
   *
   * @param limits The optional message and byte bounds.
   */
  constructor(limits: SubscriptionRelayLimits = {}) {
    this.#limits = NativeGatewayValues.relayLimits(limits);
  }

  /**
   * Copies and validates an update before FIFO admission. Count precedes bytes;
   * either bound rejects with `ResourceExhausted`.
   *
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
   *
   * @param reason The terminal failure reason.
   */
  fail(reason: unknown): void {
    this.#finish(reason);
  }

  /**
   * Returns the public iterator; `return()` cancels it and purges queued bytes, while `throw()` fails it.
   *
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

  /**
   * Dequeues the next native update or waits for stream progress.
   *
   * @returns The next iterator result.
   */ async #next(): Promise<IteratorResult<SubscriptionUpdate>> {
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

  /**
   * Fails a native update stream after its queue limit is exceeded.
   *
   * @param dimension Subscription limit dimension being checked.
   * @param limit Configured operation bound.
   * @param observed Observed subscription or lifecycle state.
   */ #failOverflow(dimension: "message" | "byte", limit: number, observed: number): never {
    const error = new ConnectError(
      `subscription relay ${dimension} limit ${String(limit)} exceeded by ${String(observed)}`,
      Code.ResourceExhausted,
    );
    this.#finish(error);
    throw error;
  }

  /**
   * Completes a native update stream and releases queued listeners.
   *
   * @param reason Failure reason returned to the caller.
   */ #finish(reason?: unknown): void {
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
  /**
   * Returns a rejected update relay promise.
   *
   * @param reason The original failure reason.
   * @returns A rejected relay promise.
   */
  rejectedRelayPromise(reason: unknown): Promise<never> {
    return Promise.resolve().then(() => {
      throw reason;
    });
  },
});

/**
 * Native Connect adapter. Post/Read use their matching Command/Query descriptors;
 * Subscribe/Activate/Cancel/Dispose use the shared Subscription descriptors.
 * Native requests carry the admitted cancellation signal and, when an issuer is
 * configured, operation-bound internal headers with detached verified reader
 * facts. Browser credentials and raw transport facts are not forwarded.
 */
export class NativeSubscriptionCreator implements SubscriptionCreator, UnaryForwarder {
  readonly #transport: Transport;

  readonly #issuer: ReaderProofIssuer | undefined;

  readonly #maxBytes: number;

  /**
   * Creates a native adapter over one Connect transport.
   *
   * @param transport The native Connect transport.
   * @param forwarding Configured peer proof issuer and existing request-size bound.
   */
  constructor(
    transport: Transport,
    forwarding?: {
      readonly issuer: ReaderProofIssuer;
      readonly maxBytes: number;
    },
  ) {
    this.#transport = transport;
    this.#issuer = forwarding?.issuer;
    this.#maxBytes = forwarding?.maxBytes ?? 4 * 1024 * 1024;
  }

  /**
   * Sends an admitted Post or Read envelope through its matching native descriptor.
   * Removes the backend transport's media type from errors before a gateway serializes them.
   *
   * @param request The admitted unary request envelope.
   * @returns The encoded native response.
   */
  async forward(request: {
    readonly service: string;
    readonly method: string;
    readonly value: Uint8Array;
    readonly reader?: TrustedReaderContext;
    readonly signal?: AbortSignal;
  }): Promise<Uint8Array> {
    try {
      const headers = request.reader === undefined ? undefined : await this.readerHeaders(request);
      return await this.#forwardResponse(request, headers);
    } catch (error) {
      throw NativeGatewayValues.publicError(error);
    }
  }

  /**
   * Invokes the selected native unary descriptor using admitted headers and cancellation.
   *
   * @param request The canonical operation and wire bytes.
   * @param headers Forwarded verified-reader proof, when configured.
   * @returns Serialized native response bytes.
   */
  async #forwardResponse(
    request: Parameters<NativeSubscriptionCreator["forward"]>[0],
    headers: Readonly<Record<string, string>> | undefined,
  ): Promise<Uint8Array> {
    const options = {
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      ...(headers === undefined ? {} : { headers }),
    };
    if (request.service === "spine.client.CommandService" && request.method === "Post")
      return toBinary(
        CommandService.method.post.output,
        await createClient(CommandService, this.#transport).post(
          fromBinary(CommandService.method.post.input, request.value),
          options,
        ),
      );
    if (request.service === "spine.client.QueryService" && request.method === "Read")
      return toBinary(
        QueryService.method.read.output,
        await createClient(QueryService, this.#transport).read(
          fromBinary(QueryService.method.read.input, request.value),
          options,
        ),
      );
    if (request.service === "spine.client.QueryService" && request.method === "Execute")
      return toBinary(
        QueryService.method.execute.output,
        await createClient(QueryService, this.#transport).execute(
          fromBinary(QueryService.method.execute.input, request.value),
          options,
        ),
      );
    throw new ConnectError("unsupported native unary operation", Code.Unimplemented);
  }

  /**
   * Builds peer-authenticated metadata for an admitted unary request.
   *
   * @param request Admitted operation and trusted reader facts.
   * @returns Headers for the configured native forwarding peer.
   */
  async readerHeaders(request: {
    readonly service: string;
    readonly method: string;
    readonly value: Uint8Array;
    readonly reader?: TrustedReaderContext | undefined;
  }): Promise<Readonly<Record<string, string>> | undefined> {
    if (request.reader === undefined) return undefined;
    if (this.#issuer === undefined) {
      if (request.reader.principal !== undefined || request.reader.authorityFacts !== undefined)
        throw new Error("Authenticated forwarding requires a configured proof issuer.");
      return undefined;
    }
    return ReaderForwarding.seal(
      request.service,
      request.method,
      request.value,
      request.reader,
      this.#issuer,
      this.#maxBytes,
    );
  }

  /**
   * Creates a native subscription with the supplied admitted cancellation signal.
   *
   * @param request The admitted canonical subscription definition.
   * @param signal The admitted cancellation signal.
   * @returns The private backend subscription envelope.
   */
  async subscribe(
    request: PublicSubscriptionWire,
    signal: SubscriptionAbortSignal,
  ): Promise<BackendSubscriptionEnvelope> {
    try {
      const topic = fromBinary(SubscriptionSchema, request.bytes).topic ?? create(TopicSchema);
      const headers = await this.readerHeaders({
        service: "spine.client.SubscriptionService",
        method: "Subscribe",
        value: toBinary(TopicSchema, topic),
        reader: request.reader,
      });
      const result = await createClient(SubscriptionService, this.#transport).subscribe(topic, {
        signal,
        ...(headers === undefined ? {} : { headers }),
      });
      return {
        kind: "backend-subscription-envelope",
        bytes: toBinary(SubscriptionSchema, result),
        ...(request.reader === undefined ? {} : { reader: request.reader }),
      };
    } catch (error) {
      throw NativeGatewayValues.publicError(error);
    }
  }

  /**
   * Streams native Activate updates through the supplied asynchronous public-update sink.
   *
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
    try {
      const headers = await this.readerHeaders({
        service: "spine.client.SubscriptionService",
        method: "Activate",
        value: toBinary(SubscriptionSchema, subscription),
        reader: request.wire.reader,
      });
      for await (const update of createClient(SubscriptionService, this.#transport).activate(
        subscription,
        { signal, ...(headers === undefined ? {} : { headers }) },
      )) {
        this.checkUpdate(subscription, update);
        await request.updates({
          kind: "subscription-update",
          bytes: toBinary(SubscriptionUpdateSchema, update),
        });
      }
    } catch (error) {
      throw NativeGatewayValues.publicError(error);
    }
  }

  /**
   * Rejects a child update from a different subscription or Topic.
   *
   * @param subscription The subscription definition being processed.
   * @param update Native subscription update.
   */
  private checkUpdate(subscription: Subscription, update: SubscriptionUpdate): void {
    const topic = subscription.topic;
    const updateTopic = update.subscription?.topic;
    if (
      update.subscription?.id?.value !== subscription.id?.value ||
      topic === undefined ||
      updateTopic === undefined ||
      !equals(TopicSchema, updateTopic, topic)
    )
      throw new Error("Backend child update does not match its subscription.");
  }

  /**
   * Cancels the native subscription represented by the canonical definition.
   *
   * @param request The canonical subscription definition.
   * @param signal The admitted cancellation signal.
   * @returns Completes after native cancellation ends.
   */
  async cancel(
    request: { readonly wire: PublicSubscriptionWire },
    signal: SubscriptionAbortSignal,
  ): Promise<void> {
    try {
      const subscription = fromBinary(SubscriptionSchema, request.wire.bytes);
      const headers = await this.readerHeaders({
        service: "spine.client.SubscriptionService",
        method: "Cancel",
        value: toBinary(SubscriptionSchema, subscription),
        reader: request.wire.reader,
      });
      await createClient(SubscriptionService, this.#transport).cancel(subscription, {
        signal,
        ...(headers === undefined ? {} : { headers }),
      });
    } catch (error) {
      throw NativeGatewayValues.publicError(error);
    }
  }

  /**
   * Performs mandatory native cancellation/disposal compensation for a private envelope.
   *
   * @param envelope The private backend subscription envelope.
   * @param signal The admitted cancellation signal.
   * @returns Completes after native disposal ends.
   */
  async dispose(
    envelope: BackendSubscriptionEnvelope,
    signal: SubscriptionAbortSignal,
  ): Promise<void> {
    try {
      const subscription = fromBinary(SubscriptionSchema, envelope.bytes);
      const headers = await this.readerHeaders({
        service: "spine.client.SubscriptionService",
        method: "Cancel",
        value: toBinary(SubscriptionSchema, subscription),
        reader: envelope.reader,
      });
      await createClient(SubscriptionService, this.#transport).cancel(subscription, {
        signal,
        ...(headers === undefined ? {} : { headers }),
      });
    } catch (error) {
      throw NativeGatewayValues.publicError(error);
    }
  }
}

/**
 * Application-owned extractor of browser credentials and allowlisted request facts from Connect context.
 */
export interface NativeGatewayRequestContext {
  // prettier-ignore

  /**
   * Reads credentials for the gateway only; they are never forwarded to native services.
   *
   * @param context The incoming Connect handler context.
   * @returns The extracted request credential.
   */
  credential(context: HandlerContext): RequestCredential | undefined;

  /**
   * Reads the allowlisted authorization and diagnostic transport view for the gateway only.
   *
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
 * Unauthenticated requests map to `Unauthenticated`; forbidden or denied requests to
 * `PermissionDenied`; request/capacity limits to `ResourceExhausted`; busy bindings to `Aborted`;
 * and unknown operations to `Unimplemented`. Malformed, stale-context, backend-envelope, and other
 * validation rejections map to `InvalidArgument`. Terminal context/iterator paths abort native
 * work. Natural completion drains FIFO updates, whereas failure or iterator cancellation purges
 * them.
 *
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
      execute: async (request, context) =>
        NativeGatewayValues.appQueryResponse(options, request, context),
    },
    subscription: NativeGatewayValues.subscriptionService(options),
  };
}

/**
 * Converts native Connect gateway inputs, responses, and errors.
 */
const NativeGatewayValues = Object.freeze({
  /**
   * Binds native subscription handlers to the existing gateway policy.
   *
   * @param options Subscription gateway and request facts.
   * @returns Connect implementation for subscription lifecycle methods.
   */
  subscriptionService(
    options: NativeGatewayServicesOptions,
  ): NativeGatewayServices["subscription"] {
    return {
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
    };
  },

  /**
   * Removes backend transport headers before another Connect server serializes the error.
   *
   * @param error The native RPC failure.
   * @returns The original failure with application metadata and details retained.
   */
  publicError(error: unknown): unknown {
    if (error instanceof ConnectError)
      for (const header of [
        "content-type",
        "grpc-status",
        "grpc-message",
        "grpc-status-details-bin",
      ])
        error.metadata.delete(header);
    return error;
  },

  /**
   * Resolves authenticated context for a public request.
   *
   * @param options Configuration for this transport operation.
   * @param request The admitted or incoming request.
   * @param context The authenticated or RPC context.
   * @returns The trusted actor context.
   */
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

  /**
   * Maps a forwarded Command result to the public response.
   *
   * @param options Configuration for this transport operation.
   * @param request The admitted or incoming request.
   * @param context The authenticated or RPC context.
   * @returns The public Command response.
   */
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

  /**
   * Maps a forwarded Query result to the public response.
   *
   * @param options Configuration for this transport operation.
   * @param request The admitted or incoming request.
   * @param context The authenticated or RPC context.
   * @returns The public Query response.
   */
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

  /**
   * Maps a forwarded application request to its public Execute response.
   *
   * @param options Gateway collaborators for this operation.
   * @param request Complete App Query envelope.
   * @param context Authenticated native request context.
   * @returns The app-node's packed paired response.
   */
  async appQueryResponse(
    options: NativeGatewayServicesOptions,
    request: AppQuery,
    context: HandlerContext,
  ): Promise<AppQueryResponse> {
    const result = await options.unary.handle({
      service: "spine.client.QueryService",
      method: "Execute",
      value: toBinary(AppQuerySchema, request),
      credential: options.requests.credential(context),
      transport: options.requests.transport(context),
      signal: context.signal,
    });
    if (result.kind === "rejected") throw NativeGatewayValues.unaryError(result);
    return fromBinary(QueryService.method.execute.output, result.value);
  },

  /**
   * Activates the authenticated subscription stream.
   *
   * @param options Configuration for this transport operation.
   * @param request The admitted or incoming request.
   * @param context The authenticated or RPC context.
   * @returns Completion or stream of activation updates.
   */
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

  /**
   * Wraps a relay as an asynchronous update stream.
   *
   * @param relay The bounded update relay.
   * @param onClose Callback invoked when the stream closes.
   * @returns An asynchronous stream of subscription updates.
   */
  activationStream(
    relay: SubscriptionUpdateRelay,
    onClose: (reason: unknown) => void,
  ): AsyncIterable<SubscriptionUpdate> {
    return {
      /**
       * Returns the public subscription update iterator.
       *
       * @returns The public update iterator.
       */
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

  /**
   * Builds a gateway request from the authenticated RPC.
   *
   * @param method The subscription RPC method.
   * @param bytes Serialized subscription request bytes.
   * @param context The authenticated or RPC context.
   * @param requests The authenticated request handler.
   * @returns The gateway request.
   */
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

  /**
   * Maps a failed unary forwarding result to a Connect error.
   *
   * @param result The gateway operation result.
   * @returns The unary Connect error.
   */
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

  /**
   * Maps a rejected gateway result to a Connect error.
   *
   * @param result The gateway operation result.
   * @returns The public Connect error.
   */
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

  /**
   * Validates and fills the update relay limits.
   *
   * @param input Caller-supplied limits.
   * @returns Validated relay limits.
   */
  relayLimits(input: SubscriptionRelayLimits): Required<SubscriptionRelayLimits> {
    const limits = { ...relayDefaults, ...input };
    for (const limit of Object.values(limits))
      if (!Number.isSafeInteger(limit) || limit <= 0)
        throw new RangeError("subscription relay limits must be positive safe integers");
    return limits;
  },

  /**
   * Converts an unknown terminal failure to a Connect error.
   *
   * @param reason The original failure reason.
   * @returns The terminal Connect error.
   */
  terminalError(reason: unknown): Error {
    return reason instanceof Error
      ? reason
      : new ConnectError("subscription stream closed", Code.Canceled);
  },
});
