import { Http2SessionManager, createGrpcTransport } from "@connectrpc/connect-node";
import { randomUUID } from "node:crypto";
import {
  Client as WebClient,
  type ClientOptions,
  type ClientTransport,
} from "@spine-event-engine/client-web";
import type { Transport } from "@connectrpc/connect";

/** Nonconstructible Node transport factories returning the shared browser-safe client kernel. */
export const Client: Readonly<{
  connectTo(baseUrl: string, options?: ClientOptions): WebClient;
  usingTransport(transport: Transport, options?: ClientOptions): WebClient;
}> = Object.freeze({
  /** Connect with a Node-owned HTTP/2 session. */
  connectTo(baseUrl: string, options: ClientOptions = {}): WebClient {
    const sessions = new Http2SessionManager(baseUrl);
    return WebClient.usingTransport(
      source(createGrpcTransport({ baseUrl, sessionManager: sessions }), () => {
        sessions.abort();
      }),
      options,
    );
  },

  /** Use a caller-owned Connect transport without closing it. */
  usingTransport(transport: Transport, options: ClientOptions = {}): WebClient {
    return WebClient.usingTransport(source(transport), options);
  },
});

function source(transport: Transport, onClose?: () => void): ClientTransport {
  return onClose === undefined
    ? { transport, createRequestId: randomUUID }
    : { transport, createRequestId: randomUUID, close: onClose };
}
