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

import { FieldnotesProxy } from "../../../private-relay";

/**
 * Keeps credential exchange and callback handling in the Node runtime.
 */
export const runtime = "nodejs";

/**
 * Prevents auth outcomes and callback fragments from being cached.
 */
export const dynamic = "force-dynamic";

/**
 * Routes one allowlisted same-origin authentication POST.
 *
 * @param request Browser authentication request.
 * @param context Next route segments.
 * @returns No-store authentication response.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  return new FieldnotesProxy(process.env).forward(request, "auth", (await context.params).path);
}

/**
 * Routes only the originless provider callback and its fixed completion redirect.
 *
 * @param request Provider navigation with one-use OIDC query values.
 * @param context Next route segments.
 * @returns No-store callback redirect or refusal.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  return new FieldnotesProxy(process.env).forward(request, "auth", (await context.params).path);
}
