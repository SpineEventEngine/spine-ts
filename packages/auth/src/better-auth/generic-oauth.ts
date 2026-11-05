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

import { genericOAuth as nativeGenericOAuth } from "better-auth/plugins/generic-oauth";

/**
 * Discovery-based provider configuration admitted by the bounded integration.
 */
export interface GenericOAuthProvider {
  /**
   * Stable configured provider identifier.
   */
  providerId: string;

  /**
   * Discovery document URL.
   */
  discoveryUrl: string;

  /**
   * OAuth client identifier.
   */
  clientId: string;

  /**
   * Confidential client secret when its method requires one.
   */
  clientSecret?: string;

  /**
   * Native token endpoint client authentication.
   */
  tokenEndpointAuth?: { method: "none" | "client_secret_basic" | "client_secret_post" };

  /**
   * Legacy secret-based authentication spelling.
   */
  authentication?: "basic" | "post";

  /**
   * Requested provider scopes.
   */
  scopes?: string[];

  /**
   * Explicit callback URI, when configured.
   */
  redirectURI?: string;

  /**
   * PKCE is required for authorization code flow.
   */
  pkce: true;

  /**
   * Requires native verification of ID tokens.
   */
  requireIdTokenVerification: true;

  /**
   * Disables native user creation.
   */
  disableSignUp: true;

  /**
   * Preserves provisioned User attributes.
   */
  overrideUserInfo: false;

  /**
   * Requires a verified email when the provider supplies one.
   */
  requireEmailVerification?: boolean;
}

/**
 * Supported native generic OAuth provider list.
 */
export interface GenericOAuthOptions {
  /**
   * Discovery-based providers registered by this plugin.
   */
  config: GenericOAuthProvider[];
}

/**
 * Calls the native generic OAuth factory while retaining the bounded input type.
 *
 * The integration validates and reconstructs this configuration before use.
 *
 * @param options Native provider configuration.
 * @returns Native plugin with the supplied configuration available for validation.
 */
export function genericOAuth(options: GenericOAuthOptions): {
  readonly id: "generic-oauth";
  readonly options: GenericOAuthOptions;
} {
  return Object.assign(nativeGenericOAuth(options), { options });
}
