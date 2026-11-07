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

/**
 * The two fixed same-origin route families forwarded to the private Node host.
 */
export type ProxyArea = "spine" | "auth";

const spinePaths = new Set([
  "/spine.client.CommandService/Post",
  "/spine.client.QueryService/Read",
  "/spine.client.SubscriptionService/Subscribe",
  "/spine.client.SubscriptionService/Activate",
  "/spine.client.SubscriptionService/Cancel",
]);

const authPosts = new Set([
  "/auth/session",
  "/auth/logout",
  "/auth/google/start",
  "/auth/google/exchange",
  "/auth/firebase/exchange",
]);

const requestNames = [
  "accept",
  "content-type",
  "connect-protocol-version",
  "origin",
  "cookie",
  "x-spine-csrf",
  "x-fieldnotes-auth",
];

const responseNames = [
  "content-type",
  "connect-protocol-version",
  "grpc-status",
  "grpc-message",
  "location",
  "referrer-policy",
  "vary",
];

/**
 * Forwards exact browser routes to one configured loopback host without buffering streams.
 */
export class FieldnotesProxy {
  readonly #upstream: URL;

  readonly #publicOrigin: string;

  /**
   * Validates the private listener and public origin independently of caller input.
   *
   * @param environment Server-only deployment configuration.
   */
  constructor(environment: Readonly<Record<string, string | undefined>>) {
    const upstream = new URL(environment.FIELDNOTES_UPSTREAM_ORIGIN ?? "");
    const publicOrigin = new URL(environment.FIELDNOTES_PUBLIC_ORIGIN ?? "");
    if (
      upstream.protocol !== "http:" || upstream.hostname !== "127.0.0.1" ||
      upstream.origin !== environment.FIELDNOTES_UPSTREAM_ORIGIN ||
      publicOrigin.protocol !== "https:" || publicOrigin.origin !== environment.FIELDNOTES_PUBLIC_ORIGIN
    ) throw new Error("Fieldnotes proxy requires fixed loopback and HTTPS origins.");
    this.#upstream = upstream;
    this.#publicOrigin = publicOrigin.origin;
  }

  /**
   * Routes one allowed request with its original body and response stream.
   *
   * @param request Browser request with its own cancellation signal.
   * @param area Fixed route family.
   * @param path Decoded Next route path segments.
   * @returns Safe no-store upstream response or generic refusal.
   */
  async forward(request: Request, area: ProxyArea, path: readonly string[]): Promise<Response> {
    const target = this.target(area, path);
    if (target === undefined || !this.allowed(area, target, request.method))
      return this.empty(404);
    const incoming = new URL(request.url);
    if (incoming.search && target !== "/auth/google/callback") return this.empty(400);
    const controller = new AbortController();
    const onAbort = () => { controller.abort(request.signal.reason); };
    request.signal.addEventListener("abort", onAbort, { once: true });
    if (request.signal.aborted) onAbort();
    const onFinish = () => { request.signal.removeEventListener("abort", onAbort); };
    try {
      return await this.relay(request, target, incoming.search, controller, onFinish);
    } catch {
      onFinish();
      return this.empty(502);
    }
  }

  /**
   * Builds only canonical route paths from route segments.
   *
   * @param area Fixed route family.
   * @param path Next route segments.
   * @returns Upstream path, or undefined for an encoded/path traversal attempt.
   */
  private target(area: ProxyArea, path: readonly string[]): string | undefined {
    if (path.length === 0 || path.some((part) => !/^[A-Za-z.]+$/.test(part)))
      return undefined;
    return area === "auth" ? `/auth/${path.join("/")}` : `/${path.join("/")}`;
  }

  /**
   * Checks the exact service or auth method admitted by the browser app.
   *
   * @param area Fixed route family.
   * @param target Canonical upstream path.
   * @param method Browser HTTP method.
   * @returns Whether this route is part of Fieldnotes.
   */
  private allowed(area: ProxyArea, target: string, method: string): boolean {
    if (area === "spine") return method === "POST" && spinePaths.has(target);
    if (target === "/auth/google/callback") return method === "GET";
    return method === "POST" && authPosts.has(target);
  }

  /**
   * Sends one bounded-header request without following provider redirects.
   *
   * @param request Admitted browser request.
   * @param target Exact private route.
   * @param search Provider callback query only.
   * @param controller Cancellation shared with upstream fetch and stream.
   * @param onFinish Removes the browser abort listener.
   * @returns Upstream response with safe headers and live body.
   */
  private async relay(
    request: Request,
    target: string,
    search: string,
    controller: AbortController,
    onFinish: () => void,
  ): Promise<Response> {
    const upstream = await fetch(new URL(target + search, this.#upstream), {
      method: request.method,
      headers: this.requestHeaders(request.headers),
      body: request.body,
      duplex: "half",
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    } as RequestInit & { duplex: "half" });
    const outward = this.responseHeaders(upstream.headers);
    if (target === "/auth/google/callback" && upstream.status === 303 &&
        !this.safeCompletion(outward.get("location"))) {
      onFinish();
      await upstream.body?.cancel();
      return this.empty(502);
    }
    if (upstream.body === null) {
      onFinish();
      return new Response(null, { status: upstream.status, headers: outward });
    }
    return new Response(this.stream(upstream.body, controller, onFinish), {
      status: upstream.status,
      headers: outward,
    });
  }

  /**
   * Removes caller-supplied forwarding and internal proof headers.
   *
   * @param source Browser request headers.
   * @returns Narrow header set admitted to the private host.
   */
  private requestHeaders(source: Headers): Headers {
    const result = new Headers();
    for (const name of requestNames) {
      const value = source.get(name);
      if (value !== null) result.set(name, value);
    }
    return result;
  }

  /**
   * Copies only public protocol headers and distinct Set-Cookie fields.
   *
   * @param source Private listener response headers.
   * @returns No-store browser response headers.
   */
  private responseHeaders(source: Headers): Headers {
    const result = new Headers({ "cache-control": "no-store" });
    for (const name of responseNames) {
      const value = source.get(name);
      if (value !== null) result.set(name, value);
    }
    for (const cookie of source.getSetCookie()) result.append("set-cookie", cookie);
    return result;
  }

  /**
   * Validates only the server's fixed completion page with a fragment-only outcome.
   *
   * @param location Upstream callback Location.
   * @returns Whether a browser may follow this redirect.
   */
  private safeCompletion(location: string | null): boolean {
    if (location === null) return false;
    const url = new URL(location);
    return url.origin === this.#publicOrigin && url.pathname === "/auth/complete" &&
      url.search === "" && (url.hash.startsWith("#grant=") || url.hash === "#result=failed");
  }

  /**
   * Streams chunks as they arrive and aborts upstream on downstream cancellation.
   *
   * @param body Actual private response body.
   * @param controller Abort link to the private listener.
   * @param onFinish Removes request-signal linkage after completion.
   * @returns Streaming response body.
   */
  private stream(
    body: ReadableStream<Uint8Array>,
    controller: AbortController,
    onFinish: () => void,
  ): ReadableStream<Uint8Array> {
    const reader = body.getReader();
    return new ReadableStream<Uint8Array>({
      async pull(outward) {
        try {
          const next = await reader.read();
          if (next.done) { outward.close(); onFinish(); }
          else outward.enqueue(next.value);
        } catch (error) { outward.error(error); onFinish(); }
      },
      async cancel(reason) {
        controller.abort(reason);
        await reader.cancel(reason).catch(() => undefined);
        onFinish();
      },
    });
  }

  /**
   * Returns a generic no-store response without internal details.
   *
   * @param status Public HTTP refusal.
   * @returns Empty refusal.
   */
  private empty(status: number): Response {
    return new Response(null, { status, headers: { "cache-control": "no-store" } });
  }
}
