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

export type BrowserAdmission =
  | { readonly sessions: SessionResolver; readonly publicAccess?: never; readonly bindings?: SubscriptionBindings }
  | { readonly sessions?: never; readonly publicAccess: true; readonly bindings?: never };

export type BrowserBackend =
  | { readonly baseUrl: string; readonly baseUrls?: never }
  | { readonly baseUrl?: never; readonly baseUrls: readonly string[] };

export interface BrowserServerCollaborators {
  readonly host?: string;
  readonly port?: number;
  readonly backend?: BrowserBackend;
  readonly discovery?: NodeDiscovery;
  readonly authRoutes?: readonly BrowserAuthRoute[];
  readonly maxActiveAuthRequests?: number;
  readonly origins: readonly string[];
  readonly registry?: TypeRegistryLookup;
  readonly authorize: AuthorizationPolicy["authorize"];
  readonly contexts: ContextResolver;
  readonly clock: Clock;
  readonly cookies?: OpaqueSessionCookies;
}

export type BrowserServerOptions = BrowserServerCollaborators & BrowserAdmission;

export interface BrowserAuthRoute {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly origins: readonly string[];
  readonly allowMissingOrigin?: boolean;
  readonly maxRequestBytes: number;
  readonly timeoutMs: number;
  readonly onRequest: (request: Request, signal: AbortSignal) => Response | Promise<Response>;
}
