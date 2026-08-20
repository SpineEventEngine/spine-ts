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
import { QuerySchema } from "@spine-event-engine/proto/client";
import type { TypeRegistryLookup } from "@spine-event-engine/core";
import type {
  AuthorizedRequestContext,
  AuthorizationPolicy,
  Clock,
  ContextResolver,
  IncomingCommand,
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
   * @param request Holds the canonical request forwarded to the backend.
   * @returns Resolves to the backend response bytes.
   */
  forward(request: {
    readonly service: string;
    readonly method: string;
    readonly value: Uint8Array;
    readonly signal?: AbortSignal;
  }): Promise<Uint8Array>;
}

/**
 * Selects exactly one Gateway admission mode.
 *
 * Supply `sessions` for authenticated requests, or `publicAccess: true` for a
 * deliberately public Gateway whose authorization policy establishes trusted
 * request context. The modes are mutually exclusive.
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

interface UnaryGatewayCollaborators {
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
   * Authorizes a principal for each decoded request.
   */
  readonly authorize: AuthorizationPolicy["authorize"];

  /**
   * Resolves the trusted actor context for an authorized request.
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
      readonly kind: "resolve-context";
      readonly service: "spine.auth.AuthenticationService";
      readonly method: "ResolveContext";
    };
type ForwardOperation = Exclude<Operation, { readonly kind: "resolve-context" }>;

/**
 * Transport-neutral B2 unary admission and context-replacement pipeline.
 */
export class UnaryGateway {
  readonly #options: UnaryGatewayOptions;

  /**
   * Creates a unary admission gateway.
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
    const requestedContext = clone(ActorContextSchema, source.requestedContext);
    const session = await this.#session(request.credential);
    if (session === undefined) return UnaryGatewayValues.reject("unauthenticated");
    const authorizationRequest = UnaryGatewayValues.decode(
      operation,
      value,
      UnaryGatewayValues.snapshotTransport(operation, transport),
      this.#options.registry,
    );
    // The same immutable owned bytes and fixed registry decoded above already proved this shape.
    /* v8 ignore next */
    if (authorizationRequest === undefined) return UnaryGatewayValues.reject("malformed-request");
    if (!(await this.#options.authorize(session.principal, authorizationRequest)))
      return UnaryGatewayValues.reject("forbidden");
    const contextRequest = UnaryGatewayValues.decode(
      operation,
      value,
      UnaryGatewayValues.snapshotTransport(operation, transport),
      this.#options.registry,
    );
    if (contextRequest === undefined) return UnaryGatewayValues.reject("malformed-request");
    const trusted = await this.#options.contexts.resolve(
      session.principal,
      contextRequest,
      this.#options.clock,
    );
    if (!UnaryGatewayValues.matches(requestedContext, trusted))
      return UnaryGatewayValues.reject("context-stale");
    return {
      kind: "forwarded",
      value: await UnaryGatewayValues.abortable(
        this.#options.forward({
          service: operation.service,
          method: operation.method,
          value: UnaryGatewayValues.rewrite(source, trusted),
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        }),
        request.signal,
      ),
    };
  }
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

  async #session(credential: RequestCredential | undefined): Promise<
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
  reject(reason: UnaryGatewayRejection): UnaryGatewayResult {
    return { kind: "rejected", reason };
  },
  operationFor(request: UnaryGatewayRequest): Operation | undefined {
    if (request.service === "spine.client.CommandService" && request.method === "Post")
      return { kind: "command", service: request.service, method: request.method };
    if (request.service === "spine.client.QueryService" && request.method === "Read")
      return { kind: "query", service: request.service, method: request.method };
    if (
      request.service === "spine.auth.AuthenticationService" &&
      request.method === "ResolveContext"
    )
      return { kind: "resolve-context", service: request.service, method: request.method };
    return undefined;
  },
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
  decode(
    operation: ForwardOperation,
    value: Uint8Array,
    transport: TransportRequestContext,
    registry: TypeRegistryLookup | undefined,
  ): IncomingCommand | IncomingQuery | undefined {
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
    return result?.kind === "command" || result?.kind === "query" ? result : undefined;
  },
  matches(requested: ActorContext, trusted: AuthorizedRequestContext): boolean {
    return (
      requested.actor?.value === trusted.actor.value &&
      UnaryGatewayValues.tenantsEqual(requested.tenantId, trusted.tenant)
    );
  },
  tenantsEqual(left: TenantId | undefined, right: TenantId | undefined): boolean {
    if (left === undefined || right === undefined) return left === right;
    const leftBytes = toBinary(TenantIdSchema, left);
    const rightBytes = toBinary(TenantIdSchema, right);
    return (
      leftBytes.byteLength === rightBytes.byteLength &&
      leftBytes.every((value, index) => value === rightBytes[index])
    );
  },
  rewrite(source: IncomingCommand | IncomingQuery, trusted: AuthorizedRequestContext): Uint8Array {
    const context = create(ActorContextSchema, {
      actor: trusted.actor,
      timestamp: trusted.timestamp,
      ...(trusted.tenant === undefined ? {} : { tenantId: trusted.tenant }),
      ...(trusted.zoneId === undefined ? {} : { zoneId: trusted.zoneId }),
      ...(trusted.language === undefined ? {} : { language: trusted.language }),
    });
    if (source.kind === "command") {
      const command = clone(CommandSchema, source.command);
      const commandContext =
        command.context === undefined
          ? create(CommandContextSchema)
          : clone(CommandContextSchema, command.context);
      commandContext.actorContext = context;
      command.context = commandContext;
      return toBinary(CommandSchema, command);
    }
    const query = clone(QuerySchema, source.query);
    query.context = context;
    return toBinary(QuerySchema, query);
  },
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
