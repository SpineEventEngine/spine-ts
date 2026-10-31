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
  ActorContextSchema,
  CommandContextSchema,
  CommandSchema,
  TenantIdSchema,
  type ActorContext,
  type TenantId,
} from "@spine-event-engine/proto";
import {
  ResolveContextRequestSchema,
  ResolveContextResponseSchema,
} from "@spine-event-engine/proto/auth";
import { AppQuerySchema, QuerySchema } from "@spine-event-engine/proto/client";
import type { TypeRegistryLookup } from "@spine-event-engine/core";
import {
  snapshotTrustedReader,
  type TrustedReaderContext,
} from "@spine-event-engine/core/spi/trusted-reader";
import type {
  AuthorizedRequestContext,
  AuthorizationPolicy,
  Clock,
  ContextResolver,
  IncomingCommand,
  IncomingAppQuery,
  IncomingQuery,
  RequestCredential,
  SessionResolver,
  TransportRequestContext,
} from "../index.js";
import { IncomingRequests } from "../request/index.js";

/**
 * Owned request bytes and canonical operation identity accepted by the B2 gateway.
 */
export interface UnaryGatewayRequest {
  // prettier-ignore

  /**
   * Identifies the requested gRPC service.
   */
  readonly service: string;

  /**
   * Identifies the requested gRPC method.
   */
  readonly method: string;

  /**
   * Holds the owned request bytes.
   */
  readonly value: Uint8Array;

  /**
   * Holds the credential resolved by the gateway.
   */
  readonly credential?: RequestCredential | undefined;

  /**
   * Holds the allowlisted request transport facts.
   */
  readonly transport: TransportRequestContext;

  /**
   * Downstream cancellation capability forwarded only to the admitted native effect.
   */
  readonly signal?: AbortSignal;
}

/**
 * B4-mappable forwarding boundary; credentials and transport extras are never supplied.
 */
export interface UnaryForwarder {
  // prettier-ignore

  /**
   * Routes an authorized request to its backend service.
   *
   * @param request Holds the canonical request forwarded to the backend.
   * @returns Resolves to the backend response bytes.
   */
  forward(request: {
    readonly service: string;
    readonly method: string;
    readonly value: Uint8Array;

    /**
     * Verified reader data, detached from the session and context resolver.
     */
    readonly reader?: TrustedReaderContext;
    readonly signal?: AbortSignal;
  }): Promise<Uint8Array>;
}

/**
 * Selects exactly one Gateway admission mode.
 *
 * Supply `sessions` for authenticated requests, or `publicAccess: true` for a
 * deliberately public Gateway. Admission establishes a principal only:
 * `authorize` decides whether that principal may perform a decoded request,
 * and `contexts` independently resolves its trusted actor and tenant context.
 * The modes are mutually exclusive.
 */
export type GatewayAdmission =
  | {
      // prettier-ignore

      /**
       * Resolves authenticated application sessions from incoming credentials.
       */
      readonly sessions: SessionResolver;

      /**
       * Excludes non-session public admission from authenticated mode.
       */
      readonly publicAccess?: never;
    }
  | {
      // prettier-ignore

      /**
       * Excludes session resolution from public mode.
       */
      readonly sessions?: never;

      /**
       * Admits requests under the framework-owned non-session public principal.
       */
      readonly publicAccess: true;
    };

/**
 * Common collaborators for every unary Gateway admission mode.
 *
 * Pair these with exactly one {@link GatewayAdmission} to form
 * {@link UnaryGatewayOptions}.
 */
export interface UnaryGatewayCollaborators {
  // prettier-ignore

  /**
   * Fixed application registry used only to decode command content for policy and context collaborators.
   */
  readonly registry?: TypeRegistryLookup;

  /**
   * Limits the number of request bytes accepted by the gateway.
   */
  readonly maxRequestBytes: number;

  /**
   * Allows or rejects an admitted principal for each decoded request.
   */
  readonly authorize: AuthorizationPolicy["authorize"];

  /**
   * Independently resolves trusted actor and tenant context after authorization.
   */
  readonly contexts: ContextResolver;

  /**
   * Provides trusted timestamps for context resolution.
   */
  readonly clock: Clock;

  /**
   * Forwards authorized bytes to the backend service.
   */
  readonly forward: UnaryForwarder["forward"];
}

/**
 * Gateway collaborators, one admission mode, and a finite byte ownership limit.
 */
export type UnaryGatewayOptions = UnaryGatewayCollaborators & GatewayAdmission;

/**
 * Transport-neutral B4-mappable rejection reasons.
 */
export type UnaryGatewayRejection =
  | "request-too-large"
  | "unknown-operation"
  | "malformed-request"
  | "unauthenticated"
  | "forbidden"
  | "context-stale";

/**
 * Forwarded/resolved bytes or a B4-mappable rejection.
 */
export type UnaryGatewayResult =
  | {
      // prettier-ignore

      /**
       * Identifies a backend-forwarded result.
       */
      readonly kind: "forwarded";

      /**
       * Holds the backend response bytes.
       */
      readonly value: Uint8Array;
    }
  | {
      // prettier-ignore

      /**
       * Identifies a resolved trusted-context result.
       */
      readonly kind: "resolved";

      /**
       * Holds the encoded trusted context.
       */
      readonly value: Uint8Array;
    }
  | {
      // prettier-ignore

      /**
       * Identifies a rejected request.
       */
      readonly kind: "rejected";

      /**
       * Explains why the request was rejected.
       */
      readonly reason: UnaryGatewayRejection;
    };

type Operation =
  | {
      readonly kind: "command";
      readonly service: "spine.client.CommandService";
      readonly method: "Post";
    }
  | {
      readonly kind: "query";
      readonly service: "spine.client.QueryService";
      readonly method: "Read";
    }
  | {
      readonly kind: "app-query";
      readonly service: "spine.client.QueryService";
      readonly method: "Execute";
    }
  | {
      readonly kind: "resolve-context";
      readonly service: "spine.auth.AuthenticationService";
      readonly method: "ResolveContext";
    };
type ForwardOperation = Exclude<Operation, { readonly kind: "resolve-context" }>;
type IncomingUnary = IncomingCommand | IncomingQuery | IncomingAppQuery;

/**
 * Transport-neutral unary admission pipeline for Commands and Queries.
 */
export class UnaryGateway {
  readonly #options: UnaryGatewayOptions;

  /**
   * Creates a unary admission gateway.
   *
   * @param options Configures admission, authorization, context, and forwarding collaborators.
   */
  constructor(options: UnaryGatewayOptions) {
    if (!Number.isSafeInteger(options.maxRequestBytes) || options.maxRequestBytes < 0)
      throw new RangeError("maxRequestBytes must be a finite non-negative integer");
    if ((options.sessions === undefined) === (options.publicAccess !== true))
      throw new Error("Unary gateway requires exactly one of sessions or publicAccess.");
    this.#options = Object.freeze({ ...options });
  }

  /**
   * Handles one admitted unary request.
   *
   * @param request Supplies owned request bytes, credential, and transport facts.
   * @returns Resolves to forwarded bytes, a trusted context, or a rejection.
   */
  async handle(request: UnaryGatewayRequest): Promise<UnaryGatewayResult> {
    if (request.value.byteLength > this.#options.maxRequestBytes)
      return UnaryGatewayValues.reject("request-too-large");
    const operation = UnaryGatewayValues.operationFor(request);
    if (operation === undefined) return UnaryGatewayValues.reject("unknown-operation");
    if (operation.kind === "resolve-context") return this.#resolveContext(request);
    const value = request.value.slice();
    const transport = UnaryGatewayValues.snapshotTransport(operation, request.transport);
    const source = UnaryGatewayValues.decode(operation, value, transport, this.#options.registry);
    if (source === undefined) return UnaryGatewayValues.reject("malformed-request");
    return this.#handleAuthorized(operation, source, value, transport, request);
  }

  /**
   * Authorizes one decoded request and resolves its trusted actor and tenant.
   *
   * @param operation Accepted asynchronous operation.
   * @param source Decoded incoming Command or Query request.
   * @param value Decoded request bytes to authorize.
   * @param transport The connected native transport.
   * @param request The request being processed.
   * @returns The authorized gateway response.
   */
  async #handleAuthorized(
    operation: ForwardOperation,
    source: IncomingUnary,
    value: Uint8Array,
    transport: TransportRequestContext,
    request: UnaryGatewayRequest,
  ): Promise<UnaryGatewayResult> {
    const requestedContext = clone(ActorContextSchema, source.requestedContext);
    const session = await this.#session(request.credential);
    if (session === undefined) return UnaryGatewayValues.reject("unauthenticated");
    const authorizationRequest = this.#decodeRequest(operation, value, transport);
    // The same immutable owned bytes and fixed registry decoded above already proved this shape.
    /* v8 ignore next */
    if (authorizationRequest === undefined) return UnaryGatewayValues.reject("malformed-request");
    if (!(await this.#options.authorize(session.principal, authorizationRequest)))
      return UnaryGatewayValues.reject("forbidden");
    const contextRequest = this.#decodeRequest(operation, value, transport);
    if (contextRequest === undefined) return UnaryGatewayValues.reject("malformed-request");
    const trusted = await this.#options.contexts.resolve(
      session.principal,
      contextRequest,
      this.#options.clock,
    );
    if (!UnaryGatewayValues.matches(requestedContext, trusted))
      return UnaryGatewayValues.reject("context-stale");
    return this.#forwardTrusted(operation, source, trusted, session.principal, request.signal);
  }

  /**
   * Decodes a fresh collaborator view from admitted bytes and fixed transport facts.
   *
   * @param operation Accepted asynchronous operation.
   * @param value Canonical request bytes decoded for the collaborator.
   * @param transport The connected native transport.
   * @returns The decoded request, if well formed.
   */
  #decodeRequest(
    operation: ForwardOperation,
    value: Uint8Array,
    transport: TransportRequestContext,
  ): IncomingUnary | undefined {
    return UnaryGatewayValues.decode(
      operation,
      value,
      UnaryGatewayValues.snapshotTransport(operation, transport),
      this.#options.registry,
    );
  }

  /**
   * Forwards the rewritten request with detached verified reader facts.
   *
   * @param operation Accepted asynchronous operation.
   * @param source Decoded incoming Command or Query request.
   * @param trusted Verified principal and authority context.
   * @param principal Verified principal from session resolution.
   * @param signal The cancellation signal for this operation.
   * @returns The verified forwarded request.
   */
  async #forwardTrusted(
    operation: ForwardOperation,
    source: IncomingUnary,
    trusted: AuthorizedRequestContext,
    principal: Parameters<AuthorizationPolicy["authorize"]>[0],
    signal: AbortSignal | undefined,
  ): Promise<UnaryGatewayResult> {
    return {
      kind: "forwarded",
      value: await UnaryGatewayValues.abortable(
        this.#options.forward({
          service: operation.service,
          method: operation.method,
          value: UnaryGatewayValues.rewrite(source, trusted),
          reader: snapshotTrustedReader({
            ...(this.#options.publicAccess === true ? {} : { principal }),
            ...(this.#options.publicAccess === true || trusted.authorityFacts === undefined
              ? {}
              : { authorityFacts: trusted.authorityFacts }),
          }),
          ...(signal === undefined ? {} : { signal }),
        }),
        signal,
      ),
    };
  }

  /**
   * Resolves an authenticated actor context request.
   *
   * @param request The incoming context request.
   * @returns The gateway result.
   */
  async #resolveContext(request: UnaryGatewayRequest): Promise<UnaryGatewayResult> {
    try {
      fromBinary(ResolveContextRequestSchema, request.value);
    } catch {
      return UnaryGatewayValues.reject("malformed-request");
    }
    const session = await this.#session(request.credential);
    if (session === undefined) return UnaryGatewayValues.reject("unauthenticated");
    const context = await this.#options.contexts.resolveContext(
      session.principal,
      this.#options.clock,
    );
    return {
      kind: "resolved",
      value: toBinary(
        ResolveContextResponseSchema,
        create(ResolveContextResponseSchema, {
          actor: context.actor,
          tenant: context.tenant,
          ...(session.expiresAt === undefined ? {} : { expiresAt: session.expiresAt }),
        }),
      ),
    };
  }

  /**
   * Resolves the current gateway session from the incoming credential.
   *
   * @param credential Incoming gateway credential, if present.
   * @returns The resolved session, if authenticated.
   */ async #session(credential: RequestCredential | undefined): Promise<
    | {
        readonly principal: { readonly id: string };
        readonly expiresAt?: import("@bufbuild/protobuf/wkt").Timestamp;
      }
    | undefined
  > {
    if (this.#options.publicAccess === true)
      return { principal: UnaryGatewayValues.publicPrincipal };
    if (credential === undefined) return undefined;
    return this.#options.sessions.resolve(credential);
  }
}
const UnaryGatewayValues = Object.freeze({
  publicPrincipal: Object.freeze({ id: "spine-gateway-public" }),

  /**
   * Creates a rejected gateway result.
   *
   * @param reason The rejection reason.
   * @returns The rejected result.
   */
  reject(reason: UnaryGatewayRejection): UnaryGatewayResult {
    return { kind: "rejected", reason };
  },

  /**
   * Returns a supported unary operation.
   *
   * @param request The incoming request.
   * @returns The operation or undefined for an unsupported method.
   */
  operationFor(request: UnaryGatewayRequest): Operation | undefined {
    if (request.service === "spine.client.CommandService" && request.method === "Post")
      return { kind: "command", service: request.service, method: request.method };
    if (request.service === "spine.client.QueryService" && request.method === "Read")
      return { kind: "query", service: request.service, method: request.method };
    if (request.service === "spine.client.QueryService" && request.method === "Execute")
      return { kind: "app-query", service: request.service, method: request.method };
    if (
      request.service === "spine.auth.AuthenticationService" &&
      request.method === "ResolveContext"
    )
      return { kind: "resolve-context", service: request.service, method: request.method };
    return undefined;
  },

  /**
   * Copies allowlisted transport facts for policy inspection.
   *
   * @param operation The selected operation.
   * @param input The incoming transport facts.
   * @returns A frozen transport snapshot.
   */
  snapshotTransport(
    operation: ForwardOperation,
    input: TransportRequestContext,
  ): TransportRequestContext {
    return Object.freeze(
      Object.fromEntries(
        Object.entries({
          service: operation.service,
          method: operation.method,
          origin: input.origin,
          requestId: input.requestId,
          correlationId: input.correlationId,
          peerAddress: input.peerAddress,
          userAgent: input.userAgent,
        }).filter(([, value]) => value !== undefined),
      ) as unknown as TransportRequestContext,
    );
  },

  /**
   * Decodes a Command or Query for policy inspection.
   *
   * @param operation The selected operation.
   * @param value The encoded request value.
   * @param transport The safe transport facts.
   * @param registry The optional domain schema registry.
   * @returns The decoded request when supported.
   */
  decode(
    operation: ForwardOperation,
    value: Uint8Array,
    transport: TransportRequestContext,
    registry: TypeRegistryLookup | undefined,
  ): IncomingUnary | undefined {
    const input =
      operation.kind === "command"
        ? {
            kind: operation.kind,
            value,
            transport,
            ...(registry === undefined ? {} : { registry }),
          }
        : { kind: operation.kind, value, transport };
    const result = IncomingRequests.decode(input);
    return result?.kind === "command" || result?.kind === "query" || result?.kind === "app-query"
      ? result
      : undefined;
  },

  /**
   * Checks the requested actor and tenant against trusted resolution.
   *
   * @param requested The isolated request actor context.
   * @param trusted The resolved actor and tenant.
   * @returns Whether both identity fields agree.
   */
  matches(requested: ActorContext, trusted: AuthorizedRequestContext): boolean {
    return (
      requested.actor?.value === trusted.actor.value &&
      UnaryGatewayValues.tenantsEqual(requested.tenantId, trusted.tenant)
    );
  },

  /**
   * Compares complete tenant identifiers.
   *
   * @param left The requested tenant.
   * @param right The resolved tenant.
   * @returns Whether the identifiers are equal.
   */
  tenantsEqual(left: TenantId | undefined, right: TenantId | undefined): boolean {
    if (left === undefined || right === undefined) return left === right;
    const leftBytes = toBinary(TenantIdSchema, left);
    const rightBytes = toBinary(TenantIdSchema, right);
    return (
      leftBytes.byteLength === rightBytes.byteLength &&
      leftBytes.every((value, index) => value === rightBytes[index])
    );
  },

  /**
   * Encodes a validated Command with its original context or a trusted Query context.
   *
   * @param source The isolated decoded request.
   * @param trusted The resolved context for identity checks or Query forwarding.
   * @returns The forwarded request bytes.
   */
  rewrite(source: IncomingUnary, trusted: AuthorizedRequestContext): Uint8Array {
    if (source.kind === "command") {
      const command = clone(CommandSchema, source.command);
      const commandContext =
        command.context === undefined
          ? create(CommandContextSchema)
          : clone(CommandContextSchema, command.context);
      commandContext.actorContext = clone(ActorContextSchema, source.requestedContext);
      command.context = commandContext;
      return toBinary(CommandSchema, command);
    }
    const context = create(ActorContextSchema, {
      actor: trusted.actor,
      timestamp: trusted.timestamp,
      ...(trusted.tenant === undefined ? {} : { tenantId: trusted.tenant }),
      ...(trusted.zoneId === undefined ? {} : { zoneId: trusted.zoneId }),
      ...(trusted.language === undefined ? {} : { language: trusted.language }),
    });
    if (source.kind === "app-query") {
      const query = clone(AppQuerySchema, source.query);
      query.context = context;
      return toBinary(AppQuerySchema, query);
    }
    const query = clone(QuerySchema, source.query);
    query.context = context;
    return toBinary(QuerySchema, query);
  },

  /**
   * Awaits an asynchronous gateway effect or request cancellation.
   *
   * @typeParam T The effect result.
   * @param effect The pending effect.
   * @param signal The optional cancellation signal.
   * @returns The effect result unless cancellation wins.
   */
  abortable<T>(effect: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    if (signal === undefined) return effect;
    if (signal.aborted) return Promise.reject(new Error("unary operation aborted"));
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        reject(new Error("unary operation aborted"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      void effect.then(resolve, reject).finally(() => {
        signal.removeEventListener("abort", onAbort);
      });
    });
  },
});
