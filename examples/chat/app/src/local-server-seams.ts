import * as http from "node:http";
import type { AddressInfo } from "node:net";

import { create } from "@bufbuild/protobuf";
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import type { ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import {
  TransportFacts,
  type Clock,
  type NativeGatewayRequestContext,
  type SessionResolver,
  type createNativeGatewayServices,
} from "@spine-event-engine/auth";
import { AuthenticationService } from "@spine-event-engine/proto/auth";
import {
  CommandService,
  QueryService,
  SubscriptionService,
} from "@spine-event-engine/proto/client";

import { LocalChatCors } from "./local-cors.js";
import type { LocalChatServerOptions } from "./local-server.js";

const localBearer = "chat-local-fixture";

/**
 * Resolves local Chat listener defaults without opening a listener.
 */
export const LocalChatOptions: Readonly<{
  // prettier-ignore

  /**
   * Resolves supplied listener options against local defaults.
   *
   * @param options Supplies optional local listener settings.
   * @returns Returns complete loopback host, port, and browser-origin settings.
   */
  resolve(options: LocalChatServerOptions): Readonly<{
    host: string;
    port: number;
    webOrigin: string;
  }>;
}> = Object.freeze({
  // prettier-ignore

  /**
   * Resolves supplied listener options against local defaults.
   *
   * @param options Supplies optional local listener settings.
   * @returns Returns complete loopback host, port, and browser-origin settings.
   */
  resolve(options: LocalChatServerOptions) {
    return {
      host: options.host ?? "127.0.0.1",
      port: options.port ?? 8090,
      webOrigin: options.webOrigin ?? "http://127.0.0.1:5173",
    };
  },
});

/**
 * Supplies the fixed local development session and clock for the Chat gateway.
 */
export const LocalChatSession: Readonly<{
  // prettier-ignore

  /**
   * Supplies the current local gateway timestamp.
   *
   * @returns Returns the current timestamp.
   */
  readonly clock: Clock;

  // prettier-ignore

  /**
   * Creates a timestamp offset from local time.
   *
   * @param offsetSeconds Supplies the offset in seconds.
   * @returns Returns the offset timestamp.
   */
  timestamp(offsetSeconds: number): Timestamp;

  // prettier-ignore

  /**
   * Creates the fixed local session resolver.
   *
   * @returns Returns the resolver for the local bearer fixture.
   */
  resolver(): SessionResolver;
}> = Object.freeze({
  // prettier-ignore

  /**
   * Supplies the current local gateway timestamp.
   *
   * @returns Returns the current timestamp.
   */
  clock: { now: () => LocalChatSession.timestamp(0) },

  // prettier-ignore

  /**
   * Creates a timestamp offset from local time.
   *
   * @param offsetSeconds Supplies the offset in seconds.
   * @returns Returns the offset timestamp.
   */
  timestamp(offsetSeconds: number): Timestamp {
    return create(TimestampSchema, {
      seconds: BigInt(Math.floor(Date.now() / 1_000) + offsetSeconds),
    });
  },

  // prettier-ignore

  /**
   * Creates the fixed local session resolver.
   *
   * @returns Returns the resolver for the local bearer fixture.
   */
  resolver(): SessionResolver {
    return {
      resolve: (credential: { readonly kind: string; readonly value: string }) =>
        Promise.resolve(
          credential.kind === "bearer" && credential.value === localBearer
            ? {
                principal: { id: "ada", attributes: { rooms: "general" } },
                expiresAt: LocalChatSession.timestamp(60),
              }
            : undefined,
        ),
    };
  },
});

/**
 * Extracts gateway request facts and registers the native service routes.
 */
export const LocalChatGatewayRequests: Readonly<{
  // prettier-ignore

  /**
   * Creates browser gateway request extractors.
   *
   * @returns Returns credential and transport extractors.
   */
  context(): NativeGatewayRequestContext;

  // prettier-ignore

  /**
   * Registers native gateway services.
   *
   * @param router Receives native service routes.
   * @param services Supplies gateway service implementations.
   */
  routes(router: ConnectRouter, services: ReturnType<typeof createNativeGatewayServices>): void;
}> = Object.freeze({
  // prettier-ignore

  /**
   * Creates browser gateway request extractors.
   *
   * @returns Returns credential and transport extractors.
   */
  context(): NativeGatewayRequestContext {
    return {
      credential: (context: { readonly requestHeader: Headers }) => {
        const bearer = /^Bearer (.+)$/.exec(context.requestHeader.get("authorization") ?? "");
        return { kind: "bearer" as const, value: bearer?.[1] ?? "" };
      },
      transport: (context: { readonly requestHeader: Headers }) => {
        const origin = context.requestHeader.get("origin");
        return TransportFacts.from({
          service: "browser",
          method: "gateway",
          ...(origin === null ? {} : { origin }),
          headers: Object.fromEntries(context.requestHeader.entries()),
        });
      },
    };
  },

  // prettier-ignore

  /**
   * Registers native gateway services.
   *
   * @param router Receives native service routes.
   * @param services Supplies gateway service implementations.
   */
  routes(router: ConnectRouter, services: ReturnType<typeof createNativeGatewayServices>) {
    router.service(AuthenticationService, services.authentication);
    router.service(CommandService, services.command);
    router.service(QueryService, services.query);
    router.service(SubscriptionService, services.subscription);
  },
});

/**
 * Creates, binds, and closes the loopback HTTP listener for the local gateway.
 */
export const LocalChatHttpListener: Readonly<{
  // prettier-ignore

  /**
   * Creates the CORS-aware HTTP listener.
   *
   * @param handler Handles non-preflight requests.
   * @param webOrigin Supplies the permitted browser origin.
   * @returns Returns the unbound HTTP server.
   */
  server(handler: ReturnType<typeof connectNodeAdapter>, webOrigin: string): http.Server;

  // prettier-ignore

  /**
   * Binds an HTTP server.
   *
   * @param server Supplies the unbound server.
   * @param host Supplies the loopback host.
   * @param port Supplies the listener port.
   * @returns Returns the bound address.
   */
  listen(server: http.Server, host: string, port: number): Promise<AddressInfo>;

  // prettier-ignore

  /**
   * Closes an HTTP server.
   *
   * @param server Supplies the bound server.
   * @returns Completes after close.
   */
  close(server: http.Server): Promise<void>;
}> = Object.freeze({
  // prettier-ignore

  /**
   * Creates the CORS-aware HTTP listener.
   *
   * @param handler Handles non-preflight requests.
   * @param webOrigin Supplies the permitted browser origin.
   * @returns Returns the unbound HTTP server.
   */
  server(handler: ReturnType<typeof connectNodeAdapter>, webOrigin: string): http.Server {
    return http.createServer((request, response) => {
      const headers = LocalChatCors.headers(
        request.headers.origin,
        request.method ?? "",
        webOrigin,
      );
      for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
      if (request.method === "OPTIONS") {
        response.statusCode = Object.keys(headers).length === 0 ? 403 : 204;
        response.end();
        return;
      }
      handler(request, response);
    });
  },

  // prettier-ignore

  /**
   * Binds an HTTP server.
   *
   * @param server Supplies the unbound server.
   * @param host Supplies the loopback host.
   * @param port Supplies the listener port.
   * @returns Returns the bound address.
   */
  listen(server: http.Server, host: string, port: number): Promise<AddressInfo> {
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        resolve(server.address() as AddressInfo);
      });
    });
  },

  // prettier-ignore

  /**
   * Closes an HTTP server.
   *
   * @param server Supplies the bound server.
   * @returns Completes after close.
   */
  close(server: http.Server): Promise<void> {
    return new Promise((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      });
    });
  },
});

/**
 * Bounds a close wait while clearing its timer after either outcome.
 */
export const LocalChatCloseTimeout: Readonly<{
  // prettier-ignore

  /**
   * Bounds a close operation.
   *
   * @param work Supplies close work.
   * @param milliseconds Supplies the wait limit.
   * @param label Supplies the resource label.
   * @returns Completes when work finishes within the limit.
   */
  within(work: Promise<void>, milliseconds: number, label: string): Promise<void>;
}> = Object.freeze({
  // prettier-ignore

  /**
   * Bounds a close operation.
   *
   * @param work Supplies close work.
   * @param milliseconds Supplies the wait limit.
   * @param label Supplies the resource label.
   * @returns Completes when work finishes within the limit.
   */
  async within(work: Promise<void>, milliseconds: number, label: string): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        work,
        new Promise<void>((_, reject) => {
          timeout = setTimeout(() => {
            reject(new Error(`${label} close timed out.`));
          }, milliseconds);
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  },
});
