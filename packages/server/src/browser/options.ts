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

import type {
  AuthorizationPolicy,
  Clock,
  ContextResolver,
  OpaqueSessionCookies,
  SessionResolver,
  SubscriptionBindings,
} from "@spine-event-engine/auth";
import type { TypeRegistryLookup } from "@spine-event-engine/core";
import type { NodeDiscovery } from "@spine-event-engine/deployment";

/**
 * Selects exactly one admission mode and binding ownership for a browser host.
 */
export type BrowserAdmission =
  | {
      // prettier-ignore

      /**
       * Resolves authenticated application sessions from incoming credentials.
       */
      readonly sessions: SessionResolver;

      /**
       * Excludes intentionally public admission from authenticated mode.
       */
      readonly publicAccess?: never;

      /**
       * Optionally supplies application-owned authenticated subscription bindings.
       */
      readonly bindings?: SubscriptionBindings;
    }
  | {
      // prettier-ignore

      /**
       * Excludes session resolution from framework-owned public admission.
       */
      readonly sessions?: never;

      /**
       * Enables intentionally public admission and framework-owned bindings.
       */
      readonly publicAccess: true;

      /**
       * Excludes bindings because public admission owns them process-locally.
       */
      readonly bindings?: never;
    };

/**
 * Describes one fixed backend or ordered fixed backend set for browser forwarding.
 */
export type BrowserBackend =
  | {
      // prettier-ignore

      /**
       * Supplies one canonical HTTP(S) backend origin.
       */
      readonly baseUrl: string;

      /**
       * Excludes a multi-backend set when one backend is supplied.
       */
      readonly baseUrls?: never;
    }
  | {
      // prettier-ignore

      /**
       * Excludes a single backend when a fixed backend set is supplied.
       */
      readonly baseUrl?: never;

      /**
       * Supplies a non-empty ordered set of canonical HTTP(S) backend origins.
       */
      readonly baseUrls: readonly string[];
    };

/**
 * Collects collaborators and listener settings for a browser gateway.
 */
export interface BrowserServerCollaborators {
  // prettier-ignore

  /**
   * Public listener host; defaults to local loopback.
   */
  readonly host?: string;

  /**
   * Public listener port; defaults to an ephemeral port.
   */
  readonly port?: number;

  /**
   * Maximum accepted request bytes; defaults to 4 MiB.
   */
  readonly readMaxBytes?: number;

  /**
   * Maximum emitted response or auth callback bytes; defaults to 4 MiB.
   */
  readonly writeMaxBytes?: number;

  /**
   * Fixed canonical HTTP(S) backends for standalone forwarding.
   */
  readonly backend?: BrowserBackend;

  /**
   * Complete-snapshot backend discovery for standalone forwarding.
   */
  readonly discovery?: NodeDiscovery;

  /**
   * Exact, bounded application auth callbacks; never a general router.
   */
  readonly authRoutes?: readonly BrowserAuthRoute[];

  /**
   * Maximum concurrently admitted auth callbacks; defaults to 64.
   */
  readonly maxActiveAuthRequests?: number;

  /**
   * Exact canonical HTTP(S) origins permitted to call Spine RPCs.
   */
  readonly origins: readonly string[];

  /**
   * Registry used to decode requests before authorization.
   */
  readonly registry?: TypeRegistryLookup;

  /**
   * Authorizes every decoded operation after admission.
   */
  readonly authorize: AuthorizationPolicy["authorize"];

  /**
   * Rebuilds trusted actor and tenant facts independently of browser input.
   */
  readonly contexts: ContextResolver;

  /**
   * Trusted clock for gateway and durable-subscription decisions.
   */
  readonly clock: Clock;

  /**
   * Strict opaque-cookie extraction alongside exact bearer credentials.
   */
  readonly cookies?: OpaqueSessionCookies;
}

/**
 * Supplies options for a combined loopback-native browser host or a standalone gateway.
 */
export type BrowserServerOptions = BrowserServerCollaborators & BrowserAdmission;

/**
 * Browser options for a gateway that does not wrap a local native server.
 *
 * A standalone gateway must forward to fixed backends or discovery; it can
 * never expose an empty routing surface.
 */
export type StandaloneBrowserServerOptions = BrowserServerOptions &
  (
    | {
        // prettier-ignore

        /**
         * Supplies fixed backends when discovery is optional.
         */
        readonly backend: BrowserBackend;

        /**
         * Optionally supplements the fixed backend set with discovery.
         */
        readonly discovery?: NodeDiscovery;
      }
    | {
        // prettier-ignore

        /**
         * Optionally supplies fixed backends alongside required discovery.
         */
        readonly backend?: BrowserBackend;

        /**
         * Supplies required discovery when no fixed backend is configured.
         */
        readonly discovery: NodeDiscovery;
      }
  );

/**
 * Defines one bounded application authentication callback exposed by a browser gateway.
 */
export interface BrowserAuthRoute {
  // prettier-ignore

  /**
   * Accepted method; auth routes only support GET or POST.
   */
  readonly method: "GET" | "POST";

  /**
   * Exact canonical non-root path; reserved Spine RPC paths are forbidden.
   */
  readonly path: string;

  /**
   * Exact canonical origins allowed for this callback.
   */
  readonly origins: readonly string[];

  /**
   * Permits an origin-less OAuth callback only when explicitly enabled.
   */
  readonly allowMissingOrigin?: boolean;

  /**
   * Positive request-body limit, capped at the transport bound.
   */
  readonly maxRequestBytes: number;

  /**
   * Positive callback deadline in milliseconds.
   */
  readonly timeoutMs: number;

  /**
   * Invokes the bounded callback only after origin and body admission.
   *
   * @param request Admitted callback request.
   * @param signal Aborts when the callback deadline expires or the client disconnects.
   * @returns A bounded callback response.
   */
  readonly onRequest: (request: Request, signal: AbortSignal) => Response | Promise<Response>;
}
