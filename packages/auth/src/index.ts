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

import type { Message } from "@bufbuild/protobuf";
import type { TypeRegistryLookup } from "@spine-event-engine/core";
import type {
  ActorContext,
  Command,
  Language,
  TenantId,
  UserId,
  ZoneId,
} from "@spine-event-engine/proto";
import {
  type Query,
  type Subscription,
  type Target,
  type Topic,
} from "@spine-event-engine/proto/client";
import type { Timestamp } from "@bufbuild/protobuf/wkt";

/**
 * Allowlisted RPC facts exposed to authorization policy and diagnostics.
 */
export interface TransportRequestContext {
  // prettier-ignore

  /**
   * Identifies the receiving RPC service.
   */
  readonly service: string;

  /**
   * Identifies the invoked RPC method.
   */
  readonly method: string;

  /**
   * Identifies the browser origin when the transport provides it.
   */
  readonly origin?: string;

  /**
   * Correlates this request with transport diagnostics.
   */
  readonly requestId?: string;

  /**
   * Correlates this request with its initiating operation.
   */
  readonly correlationId?: string;

  /**
   * Identifies the peer address when the transport provides it.
   */
  readonly peerAddress?: string;

  /**
   * Identifies the calling user agent when the transport provides it.
   */
  readonly userAgent?: string;
}

/**
 * Raw transport facts from which the safe transport view is constructed.
 */
export interface TransportFactsInput extends Omit<
  TransportRequestContext,
  "requestId" | "correlationId"
> {
  // prettier-ignore

  /**
   * Supplies raw request headers from which allowlisted values are selected.
   */
  readonly headers?: Readonly<Record<string, string | undefined>>;
}

/**
 * Command facts available to authorization policy.
 */
export interface IncomingCommand {
  // prettier-ignore

  /**
   * Identifies this request as a command.
   */
  readonly kind: "command";

  /**
   * Carries the received command envelope.
   */
  readonly command: Command;

  /**
   * Carries the unpacked command message when its type is known.
   */
  readonly message: Message | undefined;

  /**
   * Identifies the packed command message type.
   */
  readonly messageType: string;

  /**
   * Carries the context requested by the caller.
   */
  readonly requestedContext: ActorContext;

  /**
   * Carries allowlisted transport facts.
   */
  readonly transport: TransportRequestContext;
}

/**
 * Query facts available to authorization policy.
 */
export interface IncomingQuery {
  // prettier-ignore

  /**
   * Identifies this request as a query.
   */
  readonly kind: "query";

  /**
   * Carries the received query.
   */
  readonly query: Query;

  /**
   * Carries the query target.
   */
  readonly target: Target;

  /**
   * Carries the context requested by the caller.
   */
  readonly requestedContext: ActorContext;

  /**
   * Carries allowlisted transport facts.
   */
  readonly transport: TransportRequestContext;
}

/**
 * Subscription-creation facts available to authorization policy.
 */
export interface IncomingSubscription {
  // prettier-ignore

  /**
   * Identifies this request as subscription creation.
   */
  readonly kind: "subscribe";

  /**
   * Carries the requested topic.
   */
  readonly topic: Topic;

  /**
   * Carries the topic target.
   */
  readonly target: Target;

  /**
   * Carries the context requested by the caller.
   */
  readonly requestedContext: ActorContext;

  /**
   * Carries allowlisted transport facts.
   */
  readonly transport: TransportRequestContext;
}

/**
 * Subscription-activation facts available to authorization policy.
 */
export interface IncomingSubscriptionActivation {
  // prettier-ignore

  /**
   * Identifies this request as subscription activation.
   */
  readonly kind: "activate";

  /**
   * Carries the public subscription handle.
   */
  readonly subscription: Subscription;

  /**
   * Carries the context requested by the caller.
   */
  readonly requestedContext: ActorContext;

  /**
   * Carries allowlisted transport facts.
   */
  readonly transport: TransportRequestContext;
}

/**
 * Subscription-cancellation facts available to authorization policy.
 */
export interface IncomingSubscriptionCancellation {
  // prettier-ignore

  /**
   * Identifies this request as subscription cancellation.
   */
  readonly kind: "cancel";

  /**
   * Carries the public subscription handle.
   */
  readonly subscription: Subscription;

  /**
   * Carries the context requested by the caller.
   */
  readonly requestedContext: ActorContext;

  /**
   * Carries allowlisted transport facts.
   */
  readonly transport: TransportRequestContext;
}

/**
 * Exhaustive request model used at the authorization boundary.
 */
export type IncomingRequest =
  | IncomingCommand
  | IncomingQuery
  | IncomingSubscription
  | IncomingSubscriptionActivation
  | IncomingSubscriptionCancellation;

/**
 * Identity established by an application-specific authenticator.
 */
export interface AuthenticatedPrincipal {
  // prettier-ignore

  /**
   * Identifies the authenticated application principal.
   */
  readonly id: string;

  /**
   * Carries application-defined identity attributes.
   */
  readonly attributes?: Readonly<Record<string, string>>;
}

/**
 * Credential material supplied directly to an authenticator or session resolver.
 */
export interface RequestCredential {
  // prettier-ignore

  /**
   * Identifies how the credential was presented.
   */
  readonly kind: "bearer" | "cookie";

  /**
   * Carries the opaque credential material.
   */
  readonly value: string;
}

/**
 * Cookie credential issued by an application-session strategy.
 */
export interface CookieCredential extends RequestCredential {
  // prettier-ignore

  /**
   * Identifies this credential as a cookie.
   */
  readonly kind: "cookie";
}

/**
 * Bearer credential issued by a signed application-session strategy.
 */
export interface BearerCredential extends RequestCredential {
  // prettier-ignore

  /**
   * Identifies this credential as a bearer token.
   */
  readonly kind: "bearer";
}

/**
 * Session validated by an application-selected session strategy.
 */
export interface ResolvedSession {
  // prettier-ignore

  /**
   * Identifies the authenticated session principal.
   */
  readonly principal: AuthenticatedPrincipal;

  /**
   * Specifies when the resolved session expires.
   */
  readonly expiresAt: Timestamp;
}

/**
 * Provider-neutral authentication boundary. Credentials do not reach policy request facts.
 */
export interface Authenticator {
  // prettier-ignore

  /**
   * Validates a presented credential.
   * @param credential Supplies the credential to authenticate.
   * @returns Returns the authenticated principal or `undefined` when rejected.
   */
  authenticate(credential: RequestCredential): Promise<AuthenticatedPrincipal | undefined>;
}

/**
 * Application-session validation boundary.
 */
export interface SessionResolver {
  // prettier-ignore

  /**
   * Resolves a presented credential into a valid session.
   * @param credential Supplies the credential to resolve.
   * @returns Returns the resolved session or `undefined` when it is invalid.
   */
  resolve(credential: RequestCredential): Promise<ResolvedSession | undefined>;
}

/**
 * Authorization policy boundary evaluated separately for every incoming request.
 */
export interface AuthorizationPolicy {
  // prettier-ignore

  /**
   * Checks whether a principal may make one incoming request.
   * @param principal Supplies the authenticated principal.
   * @param request Supplies the request being authorized.
   * @returns Returns whether the request is allowed.
   */
  authorize(principal: AuthenticatedPrincipal, request: IncomingRequest): Promise<boolean>;
}

/**
 * Gateway-owned trusted context supplied after authentication and authorization.
 */
export interface AuthorizedRequestContext {
  // prettier-ignore

  /**
   * Identifies the resolved application actor.
   */
  readonly actor: UserId;

  /**
   * Identifies the resolved tenant when the application is multi-tenant.
   */
  readonly tenant?: TenantId;

  /**
   * Records the trusted resolution time.
   */
  readonly timestamp: Timestamp;

  /**
   * Identifies the actor's time zone when resolved.
   */
  readonly zoneId?: ZoneId;

  /**
   * Identifies the actor's language when resolved.
   */
  readonly language?: Language;
}

/**
 * Application-owned actor and tenant resolution boundary.
 */
export interface ContextResolver {
  // prettier-ignore

  /**
   * Resolves a trusted context for one authorized request.
   * @param principal Supplies the authenticated principal.
   * @param request Supplies the authorized request.
   * @param clock Supplies the trusted timestamp source.
   * @returns Returns the resolved actor context.
   */
  resolve(
    principal: AuthenticatedPrincipal,
    request: IncomingRequest,
    clock: Clock,
  ): Promise<AuthorizedRequestContext>;

  /**
   * Resolves a context when only the principal is available.
   * @param principal Supplies the authenticated principal.
   * @param clock Supplies the trusted timestamp source.
   * @returns Returns the resolved actor context.
   */
  resolveContext(
    principal: AuthenticatedPrincipal,
    clock: Clock,
  ): Promise<AuthorizedRequestContext>;
}

/**
 * Clock boundary for trusted timestamps and deterministic gateway tests.
 */
export interface Clock {
  // prettier-ignore

  /**
   * Returns the current trusted timestamp.
   * @returns Returns the current timestamp.
   */
  now(): Timestamp;
}

/**
 * Envelope-decoding boundary used by the later gateway pipeline.
 */
export interface RequestDecoder {
  // prettier-ignore

  /**
   * Decodes one transport request.
   * @param input Supplies the wire request input.
   * @returns Returns decoded request facts or `undefined` for invalid input.
   */
  decode(input: IncomingRequestInput): IncomingRequest | undefined;
}

/**
 * Wire envelope shape decoded by the gateway's later forwarding pipeline.
 */
export type IncomingRequestInput =
  | CommandRequestInput
  | {
      // prettier-ignore

      /**
       * Identifies this input as a query.
       */
      readonly kind: "query";

      /**
       * Carries the serialized query bytes.
       */
      readonly value: Uint8Array;

      /**
       * Carries allowlisted transport facts.
       */
      readonly transport: TransportRequestContext;
    }
  | {
      // prettier-ignore

      /**
       * Identifies this input as subscription creation.
       */
      readonly kind: "subscribe";

      /**
       * Carries the serialized topic bytes.
       */
      readonly value: Uint8Array;

      /**
       * Carries allowlisted transport facts.
       */
      readonly transport: TransportRequestContext;
    }
  | {
      // prettier-ignore

      /**
       * Identifies this input as subscription activation.
       */
      readonly kind: "activate";

      /**
       * Carries the serialized subscription bytes.
       */
      readonly value: Uint8Array;

      /**
       * Carries allowlisted transport facts.
       */
      readonly transport: TransportRequestContext;
    }
  | {
      // prettier-ignore

      /**
       * Identifies this input as subscription cancellation.
       */
      readonly kind: "cancel";

      /**
       * Carries the serialized subscription bytes.
       */
      readonly value: Uint8Array;

      /**
       * Carries allowlisted transport facts.
       */
      readonly transport: TransportRequestContext;
    };

/**
 * Wire command envelope with an optional registry for content-aware policy.
 */
export interface CommandRequestInput {
  // prettier-ignore

  /**
   * Identifies this input as a command.
   */
  readonly kind: "command";

  /**
   * Carries the serialized command bytes.
   */
  readonly value: Uint8Array;

  /**
   * Carries allowlisted transport facts.
   */
  readonly transport: TransportRequestContext;

  /**
   * Supplies message types used to unpack the command when available.
   */
  readonly registry?: TypeRegistryLookup;
}

interface TransportFactsApi {
  from(input: TransportFactsInput): TransportRequestContext;
}

/**
 * Builds the allowlisted transport facts used by authorization and diagnostics.
 */
export const TransportFacts: Readonly<TransportFactsApi> = Object.freeze({
  // prettier-ignore

  /**
   * Builds allowlisted facts while omitting credentials and unknown headers.
   * @param input Supplies raw transport facts and optional headers.
   * @returns Returns the safe transport context.
   */
  from(input: TransportFactsInput): TransportRequestContext {
    const headers = Object.fromEntries(
      Object.entries(input.headers ?? {})
        .filter((entry): entry is [string, string] => entry[1] !== undefined)
        .map(([name, value]) => [name.toLowerCase(), value]),
    );
    return TransportFactsValues.compact({
      service: input.service,
      method: input.method,
      origin: input.origin,
      requestId: headers["x-request-id"],
      correlationId: headers["x-correlation-id"],
      peerAddress: input.peerAddress,
      userAgent: input.userAgent,
    });
  },
});
export { IncomingRequests } from "./request/index.js";
const TransportFactsValues = Object.freeze({
  compact(
    context: Readonly<Record<string, string | undefined>> &
      Pick<TransportRequestContext, "service" | "method">,
  ): TransportRequestContext {
    return Object.fromEntries(
      Object.entries(context).filter(([, value]) => value !== undefined),
    ) as unknown as TransportRequestContext;
  },
});

export { UnaryGateway } from "./gateway/index.js";
export { OpaqueSessionCookies } from "./sessions/cookies.js";
export { OpaqueSessions } from "./sessions/opaque.js";
export { SignedSessions } from "./sessions/signed.js";
export { OidcFlow } from "./oidc/index.js";
export {
  createGitHubProvider,
  createGoogleProvider,
  createOidcProvider,
  discoverOidcProvider,
} from "./providers/index.js";
export { InMemorySubscriptionBindings, SubscriptionGateway } from "./subscriptions/index.js";
export {
  createNativeGatewayServices,
  NativeSubscriptionCreator,
  SubscriptionUpdateRelay,
} from "./native/index.js";
export type {
  UnaryForwarder,
  GatewayAdmission,
  UnaryGatewayCollaborators,
  UnaryGatewayOptions,
  UnaryGatewayRejection,
  UnaryGatewayRequest,
  UnaryGatewayResult,
} from "./gateway/index.js";
export type {
  SubscriptionCreator,
  SubscriptionCoordinator,
  SubscriptionGatewayLimits,
  SubscriptionGatewayOptions,
  SubscriptionGatewayRequest,
  SubscriptionGatewayResult,
  SubscriptionBindings,
  SubscriptionAbortSignal,
  SubscriptionBindingTransition,
  SubscriptionTopicWire,
  PublicSubscriptionWire,
  BackendSubscriptionEnvelope,
  OnSubscriptionDefinition,
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
export type {
  ConfiguredOidcProvider,
  GitHubProviderOptions,
  OidcClientAuthentication,
  OidcProviderOptions,
  ProviderFetch,
} from "./providers/index.js";
export {
  DynamicUnaryForwarder,
  type DynamicUnaryClient,
  type DynamicUnaryOptions,
} from "./gateway/dynamic-unary-forwarder.js";
export { DynamicSubscriptionCreator } from "./gateway/dynamic-subscription-creator.js";
