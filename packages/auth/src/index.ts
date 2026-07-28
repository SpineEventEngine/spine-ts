import { create, fromBinary, type Message } from "@bufbuild/protobuf";
import { unpackAnyUsing, type TypeRegistryLookup } from "@spine-event-engine/core";
import type {
  ActorContext,
  Command,
  Language,
  TenantId,
  UserId,
  ZoneId,
} from "@spine-event-engine/proto";
import { ActorContextSchema, CommandSchema } from "@spine-event-engine/proto";
import {
  QuerySchema,
  SubscriptionSchema,
  TargetSchema,
  TopicSchema,
  type Query,
  type Subscription,
  type Target,
  type Topic,
} from "@spine-event-engine/proto/client";
import type { Timestamp } from "@bufbuild/protobuf/wkt";

/** Allowlisted RPC facts exposed to authorization policy and diagnostics. */
export interface TransportRequestContext {
  readonly service: string;
  readonly method: string;
  readonly origin?: string;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly peerAddress?: string;
  readonly userAgent?: string;
}
/** Raw transport facts from which the safe transport view is constructed. */
export interface TransportFactsInput extends Omit<
  TransportRequestContext,
  "requestId" | "correlationId"
> {
  readonly headers?: Readonly<Record<string, string | undefined>>;
}
/** Command facts available to authorization policy. */
export interface IncomingCommand {
  readonly kind: "command";
  readonly command: Command;
  readonly message: Message | undefined;
  readonly messageType: string;
  readonly requestedContext: ActorContext;
  readonly transport: TransportRequestContext;
}
/** Query facts available to authorization policy. */
export interface IncomingQuery {
  readonly kind: "query";
  readonly query: Query;
  readonly target: Target;
  readonly requestedContext: ActorContext;
  readonly transport: TransportRequestContext;
}
/** Subscription-creation facts available to authorization policy. */
export interface IncomingSubscription {
  readonly kind: "subscribe";
  readonly topic: Topic;
  readonly target: Target;
  readonly requestedContext: ActorContext;
  readonly transport: TransportRequestContext;
}
/** Subscription-activation facts available to authorization policy. */
export interface IncomingSubscriptionActivation {
  readonly kind: "activate";
  readonly subscription: Subscription;
  readonly requestedContext: ActorContext;
  readonly transport: TransportRequestContext;
}
/** Subscription-cancellation facts available to authorization policy. */
export interface IncomingSubscriptionCancellation {
  readonly kind: "cancel";
  readonly subscription: Subscription;
  readonly requestedContext: ActorContext;
  readonly transport: TransportRequestContext;
}
/** Exhaustive request model used at the authorization boundary. */
export type IncomingRequest =
  | IncomingCommand
  | IncomingQuery
  | IncomingSubscription
  | IncomingSubscriptionActivation
  | IncomingSubscriptionCancellation;
/** Identity established by an application-specific authenticator. */
export interface AuthenticatedPrincipal {
  readonly id: string;
  readonly attributes?: Readonly<Record<string, string>>;
}
/** Credential material supplied directly to an authenticator or session resolver. */
export interface RequestCredential {
  readonly kind: "bearer" | "cookie";
  readonly value: string;
}
/** Cookie credential issued by an application-session strategy. */
export interface CookieCredential extends RequestCredential {
  readonly kind: "cookie";
}
/** Bearer credential issued by a signed application-session strategy. */
export interface BearerCredential extends RequestCredential {
  readonly kind: "bearer";
}
/** Session validated by an application-selected session strategy. */
export interface ResolvedSession {
  readonly principal: AuthenticatedPrincipal;
  readonly expiresAt: Timestamp;
}
/** Provider-neutral authentication boundary. Credentials do not reach policy request facts. */
export interface Authenticator {
  authenticate(credential: RequestCredential): Promise<AuthenticatedPrincipal | undefined>;
}
/** Application-session validation boundary. Session persistence is deferred to Wave 4 C. */
export interface SessionResolver {
  resolve(credential: RequestCredential): Promise<ResolvedSession | undefined>;
}
/** Authorization policy boundary evaluated separately for every incoming request. */
export interface AuthorizationPolicy {
  authorize(principal: AuthenticatedPrincipal, request: IncomingRequest): Promise<boolean>;
}
/** Gateway-owned trusted context supplied after authentication and authorization. */
export interface AuthorizedRequestContext {
  readonly actor: UserId;
  readonly tenant?: TenantId;
  readonly timestamp: Timestamp;
  readonly zoneId?: ZoneId;
  readonly language?: Language;
}
/** Application-owned actor and tenant resolution boundary. */
export interface ContextResolver {
  resolve(
    principal: AuthenticatedPrincipal,
    request: IncomingRequest,
    clock: Clock,
  ): Promise<AuthorizedRequestContext>;
  resolveContext(
    principal: AuthenticatedPrincipal,
    clock: Clock,
  ): Promise<AuthorizedRequestContext>;
}
/** Clock boundary for trusted timestamps and deterministic gateway tests. */
export interface Clock {
  now(): Timestamp;
}
/** Envelope-decoding boundary used by the later gateway pipeline. */
export interface RequestDecoder {
  decode(input: IncomingRequestInput): IncomingRequest | undefined;
}
/** Wire envelope shape decoded by the gateway's later forwarding pipeline. */
export type IncomingRequestInput =
  | CommandRequestInput
  | {
      readonly kind: "query";
      readonly value: Uint8Array;
      readonly transport: TransportRequestContext;
    }
  | {
      readonly kind: "subscribe";
      readonly value: Uint8Array;
      readonly transport: TransportRequestContext;
    }
  | {
      readonly kind: "activate";
      readonly value: Uint8Array;
      readonly transport: TransportRequestContext;
    }
  | {
      readonly kind: "cancel";
      readonly value: Uint8Array;
      readonly transport: TransportRequestContext;
    };
/** Wire command envelope with an optional Wave 3 registry for content-aware policy. */
export interface CommandRequestInput {
  readonly kind: "command";
  readonly value: Uint8Array;
  readonly transport: TransportRequestContext;
  readonly registry?: TypeRegistryLookup;
}

/** Select allowlisted transport facts; credentials and unknown headers are omitted. */
export function transportFacts(input: TransportFactsInput): TransportRequestContext {
  const headers = Object.fromEntries(
    Object.entries(input.headers ?? {})
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([name, value]) => [name.toLowerCase(), value]),
  );
  return compactFacts({
    service: input.service,
    method: input.method,
    origin: input.origin,
    requestId: headers["x-request-id"],
    correlationId: headers["x-correlation-id"],
    peerAddress: input.peerAddress,
    userAgent: input.userAgent,
  });
}
export { decodeIncomingRequest } from "./request/index.js";
function compactFacts(
  context: Readonly<Record<string, string | undefined>> &
    Pick<TransportRequestContext, "service" | "method">,
): TransportRequestContext {
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined),
  ) as unknown as TransportRequestContext;
}

export { UnaryGateway } from "./gateway/index.js";
export { OpaqueSessionCookies } from "./sessions/cookies.js";
export { OpaqueSessions } from "./sessions/opaque.js";
export { SignedSessions } from "./sessions/signed.js";
export { OidcFlow } from "./oidc/index.js";
export { InMemorySubscriptionBindings, SubscriptionGateway } from "./subscriptions/index.js";
export {
  createNativeGatewayServices,
  NativeSubscriptionCreator,
  SubscriptionUpdateRelay,
} from "./native/index.js";
export type {
  UnaryForwarder,
  UnaryGatewayOptions,
  UnaryGatewayRejection,
  UnaryGatewayRequest,
  UnaryGatewayResult,
} from "./gateway/index.js";
export type {
  SubscriptionCreator,
  SubscriptionGatewayLimits,
  SubscriptionGatewayOptions,
  SubscriptionGatewayRequest,
  SubscriptionGatewayResult,
  SubscriptionBindings,
  SubscriptionAbortSignal,
  SubscriptionBindingTransition,
  SubscriptionCapacityReservation,
  SubscriptionTopicWire,
  PublicSubscriptionWire,
  BackendSubscriptionEnvelope,
  OnBackendSubscription,
  SubscriptionUpdateSink,
  SubscriptionUpdateWire,
} from "./subscriptions/index.js";
export type {
  NativeGatewayRequestContext,
  NativeGatewayServices,
  NativeGatewayServicesOptions,
  SubscriptionRelayLimits,
} from "./native/index.js";
export type {
  OpaqueCredentialExtraction,
  OpaqueCredentialRejection,
  OpaqueSessionCookiesOptions,
  OpaqueSessionHeaders,
} from "./sessions/cookies.js";
export type {
  OpaqueSessionClock,
  OpaqueSessionCreateResult,
  OpaqueSessionLogoutResult,
  OpaqueSessionRandom,
  OpaqueSessionRotateResult,
  OpaqueSessionsOptions,
} from "./sessions/opaque.js";
export type {
  SignedSessionClock,
  SignedSessionIssueResult,
  SignedSessionLogoutResult,
  SignedSessionRandom,
  SignedSessionRotationResult,
  SignedSessionSigningKey,
  SignedSessionVerificationKey,
  SignedSessionsOptions,
  SignedTokenRevocation,
} from "./sessions/signed.js";
export type {
  ApplicationSessionIssue,
  ApplicationSessionIssuer,
  ExternalIdentity,
  IdentityMapping,
  OidcAuthorizationCodeExchange,
  OidcFlowCallbackInput,
  OidcFlowCallbackResult,
  OidcFlowClock,
  OidcFlowExchangeInput,
  OidcFlowExchangeResult,
  OidcFlowOptions,
  OidcFlowRandom,
  OidcFlowStartInput,
  OidcFlowStartResult,
  OidcVerifiedIdentityProvider,
  ResolvedApplicationIdentity,
} from "./oidc/contracts.js";
