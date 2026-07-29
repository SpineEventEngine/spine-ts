import type { AuthenticatedPrincipal, RequestCredential, ResolvedSession } from "../index.js";

/** Clock used to evaluate finite OIDC transactions. */
export interface OidcFlowClock {
  /** Returns a safe Unix epoch millisecond value in the Protobuf Timestamp range. */
  now(): number;
}

/** Random source used for OIDC state, nonce, and provider PKCE verifier material. */
export type OidcFlowRandom = (length: number) => Uint8Array;

/** A provider identity verified against its authorization-code response. */
export interface ExternalIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly claims?: Readonly<Record<string, string>>;
}

/** Application identity produced by a provider-neutral mapping. */
export interface ResolvedApplicationIdentity {
  readonly externalIdentity: ExternalIdentity;
  readonly principal: AuthenticatedPrincipal;
}

/** Application-owned mapping from a verified external identity to a principal. */
export interface IdentityMapping {
  resolve(
    identity: ExternalIdentity,
    signal: AbortSignal,
  ): Promise<ResolvedApplicationIdentity | undefined>;
}

/** Input to an adapter that exchanges and verifies an authorization code. */
export interface OidcAuthorizationCodeExchange {
  readonly code: string;
  readonly clientId: string;
  readonly callbackUri: string;
  readonly providerCodeVerifier: string;
  readonly expectedNonce: string;
  readonly signal: AbortSignal;
}

/** Provider-specific authorization-code and identity-verification seam. */
export interface OidcVerifiedIdentityProvider {
  readonly issuer: string;
  exchangeAuthorizationCode(
    input: OidcAuthorizationCodeExchange,
  ): Promise<ExternalIdentity | undefined>;
}

/** Result issued by the application-selected application-session strategy. */
export interface ApplicationSessionIssue {
  readonly credential: RequestCredential;
  readonly session: ResolvedSession;
}

/** Application-session seam used only after a successful OIDC grant exchange. */
export interface ApplicationSessionIssuer {
  issue(
    principal: AuthenticatedPrincipal,
    signal: AbortSignal,
  ): Promise<ApplicationSessionIssue | undefined>;
}

/** Construction options for the bounded, framework-neutral OIDC code flow. */
export interface OidcFlowOptions {
  readonly authorizationEndpoint: string;
  readonly callbackUri: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
  readonly allowedPostLoginRedirects: readonly string[];
  readonly provider: OidcVerifiedIdentityProvider;
  readonly identityMapping: IdentityMapping;
  readonly sessionIssuer: ApplicationSessionIssuer;
  readonly clock?: OidcFlowClock;
  readonly randomBytes?: OidcFlowRandom;
  readonly transactionTtlMilliseconds?: number;
  readonly grantTtlMilliseconds?: number;
  readonly maxTransactions?: number;
  readonly maxGrants?: number;
  readonly collisionAttempts?: number;
  readonly operationTimeoutMilliseconds?: number;
  readonly maxAuthorizationUrlLength?: number;
}

/** Input accepted by {@link OidcFlow.start}. */
export interface OidcFlowStartInput {
  /** Browser-generated RFC 7636 S256 code challenge. */
  readonly browserCodeChallenge: string;
  /** Exact preconfigured application redirect to use after successful sign-in. */
  readonly postLoginRedirect: string;
}

/** Result of opening one authorization-code transaction. */
export type OidcFlowStartResult =
  | { readonly kind: "started"; readonly authorizationUrl: string; readonly expiresAt: number }
  | {
      readonly kind: "rejected";
      readonly reason:
        "invalid-input" | "capacity-exceeded" | "entropy-exhausted" | "clock-failure" | "closed";
    };

/** Common callback facts. Exactly one of code or error is required. */
export interface OidcFlowCallbackBase {
  readonly state: string;
  /** Optional issuer returned by a provider authorization response. */
  readonly responseIssuer?: string;
}
/** Input accepted by {@link OidcFlow.callback}. */
export type OidcFlowCallbackInput =
  | (OidcFlowCallbackBase & { readonly code: string; readonly error?: never })
  | (OidcFlowCallbackBase & { readonly error: string; readonly code?: never });

/** Result of atomically consuming an authorization-code transaction. */
export type OidcFlowCallbackResult =
  | {
      readonly kind: "granted";
      readonly grant: string;
      readonly postLoginRedirect: string;
      readonly expiresAt: number;
    }
  | {
      readonly kind: "rejected";
      readonly reason:
        | "invalid-input"
        | "not-found"
        | "expired"
        | "provider-error"
        | "issuer-mismatch"
        | "verification-failed"
        | "mapping-failed"
        | "capacity-exceeded"
        | "entropy-exhausted"
        | "clock-failure"
        | "closed";
    };

/** Input accepted by {@link OidcFlow.exchange}. */
export interface OidcFlowExchangeInput {
  /** One-time grant returned by {@link OidcFlow.callback}. */
  readonly grant: string;
  /** Browser-held RFC 7636 verifier for the application's separate grant. */
  readonly browserCodeVerifier: string;
}

/** Enumeration-safe result of a one-time application-session exchange. */
export type OidcFlowExchangeResult =
  | {
      readonly kind: "issued";
      readonly credential: RequestCredential;
      readonly session: ResolvedSession;
    }
  | { readonly kind: "rejected" };
