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
 * Keeps Connect RPC and subscription streams in the long-lived Node runtime.
 */
export const runtime = "nodejs";

/**
 * Prevents authenticated RPC responses from becoming route cache entries.
 */
export const dynamic = "force-dynamic";

/**
 * Routes a canonical private Connect POST through the fixed loopback host.
 *
 * @param request Browser Connect request.
 * @param context Next route segments.
 * @returns Streaming no-store Connect response.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  return new FieldnotesProxy(process.env).forward(request, "spine", (await context.params).path);
}
