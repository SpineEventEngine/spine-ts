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
import { decodeIncomingRequest } from "../request/index.js";

/** Owned request bytes and canonical operation identity accepted by the B2 gateway. */
export interface UnaryGatewayRequest {
  readonly service: string;
  readonly method: string;
  readonly value: Uint8Array;
  readonly credential: RequestCredential;
  readonly transport: TransportRequestContext;
}
/** B4-mappable forwarding boundary; credentials and transport extras are never supplied. */
export interface UnaryForwarder {
  forward(request: {
    readonly service: string;
    readonly method: string;
    readonly value: Uint8Array;
  }): Promise<Uint8Array>;
}
/** Gateway collaborators and finite byte ownership limit. */
export interface UnaryGatewayOptions {
  readonly maxRequestBytes: number;
  readonly sessions: SessionResolver;
  readonly authorize: AuthorizationPolicy["authorize"];
  readonly contexts: ContextResolver;
  readonly clock: Clock;
  readonly forward: UnaryForwarder["forward"];
}
/** Transport-neutral B4-mappable rejection reasons. */
export type UnaryGatewayRejection =
  | "request-too-large"
  | "unknown-operation"
  | "malformed-request"
  | "unauthenticated"
  | "forbidden"
  | "context-stale";
/** Forwarded/resolved bytes or a B4-mappable rejection. */
export type UnaryGatewayResult =
  | { readonly kind: "forwarded"; readonly value: Uint8Array }
  | { readonly kind: "resolved"; readonly value: Uint8Array }
  | { readonly kind: "rejected"; readonly reason: UnaryGatewayRejection };

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

/** Transport-neutral B2 unary authentication and context-replacement pipeline. */
export class UnaryGateway {
  readonly #options: UnaryGatewayOptions;
  constructor(options: UnaryGatewayOptions) {
    if (!Number.isSafeInteger(options.maxRequestBytes) || options.maxRequestBytes < 0)
      throw new RangeError("maxRequestBytes must be a finite non-negative integer");
    this.#options = options;
  }
  async handle(request: UnaryGatewayRequest): Promise<UnaryGatewayResult> {
    if (request.value.byteLength > this.#options.maxRequestBytes)
      return reject("request-too-large");
    const operation = operationFor(request);
    if (operation === undefined) return reject("unknown-operation");
    if (operation.kind === "resolve-context") return this.#resolveContext(request);
    const value = request.value.slice();
    const transport = snapshotTransport(operation, request.transport);
    const source = decode(operation, value, transport);
    if (source === undefined) return reject("malformed-request");
    const requestedContext = clone(ActorContextSchema, source.requestedContext);
    const session = await this.#options.sessions.resolve(request.credential);
    if (session === undefined) return reject("unauthenticated");
    const authorizationRequest = decode(operation, value, snapshotTransport(operation, transport));
    if (authorizationRequest === undefined) return reject("malformed-request");
    if (!(await this.#options.authorize(session.principal, authorizationRequest)))
      return reject("forbidden");
    const contextRequest = decode(operation, value, snapshotTransport(operation, transport));
    if (contextRequest === undefined) return reject("malformed-request");
    const trusted = await this.#options.contexts.resolve(
      session.principal,
      contextRequest,
      this.#options.clock,
    );
    if (!matches(requestedContext, trusted)) return reject("context-stale");
    return {
      kind: "forwarded",
      value: await this.#options.forward({
        service: operation.service,
        method: operation.method,
        value: rewrite(source, trusted),
      }),
    };
  }
  async #resolveContext(request: UnaryGatewayRequest): Promise<UnaryGatewayResult> {
    try {
      fromBinary(ResolveContextRequestSchema, request.value);
    } catch {
      return reject("malformed-request");
    }
    const session = await this.#options.sessions.resolve(request.credential);
    if (session === undefined) return reject("unauthenticated");
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
          expiresAt: session.expiresAt,
        }),
      ),
    };
  }
}
function reject(reason: UnaryGatewayRejection): UnaryGatewayResult {
  return { kind: "rejected", reason };
}
function operationFor(request: UnaryGatewayRequest): Operation | undefined {
  if (request.service === "spine.client.CommandService" && request.method === "Post")
    return { kind: "command", service: request.service, method: request.method };
  if (request.service === "spine.client.QueryService" && request.method === "Read")
    return { kind: "query", service: request.service, method: request.method };
  if (request.service === "spine.auth.AuthenticationService" && request.method === "ResolveContext")
    return { kind: "resolve-context", service: request.service, method: request.method };
  return undefined;
}
function snapshotTransport(
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
}
function decode(
  operation: ForwardOperation,
  value: Uint8Array,
  transport: TransportRequestContext,
): IncomingCommand | IncomingQuery | undefined {
  const result = decodeIncomingRequest({ kind: operation.kind, value, transport });
  return result?.kind === "command" || result?.kind === "query" ? result : undefined;
}
function matches(requested: ActorContext, trusted: AuthorizedRequestContext): boolean {
  return (
    requested.actor?.value === trusted.actor.value &&
    tenantsEqual(requested.tenantId, trusted.tenant)
  );
}
function tenantsEqual(left: TenantId | undefined, right: TenantId | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  const leftBytes = toBinary(TenantIdSchema, left);
  const rightBytes = toBinary(TenantIdSchema, right);
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    leftBytes.every((value, index) => value === rightBytes[index])
  );
}
function rewrite(
  source: IncomingCommand | IncomingQuery,
  trusted: AuthorizedRequestContext,
): Uint8Array {
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
}
