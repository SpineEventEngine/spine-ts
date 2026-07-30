import { Http2SessionManager, createGrpcTransport } from "@connectrpc/connect-node";
import { randomUUID } from "node:crypto";
import {
  Client as WebClient,
  type ClientOptions,
  type ClientTransport,
} from "@spine-event-engine/client-web";
import type { Transport } from "@connectrpc/connect";

/** Creates Node transport-backed instances of the shared browser-safe client kernel. */
export const Client: Readonly<{
  /** Connects through a Node-owned HTTP/2 session.
   *
   * @param baseUrl - Gateway base URL.
   * @param options - Shared client construction options.
   * @returns A client that closes its owned HTTP/2 session.
   */
  connectTo(baseUrl: string, options?: ClientOptions): WebClient;
  /** Uses a caller-owned Connect transport.
   *
   * @param transport - Connect transport that remains caller-owned.
   * @param options - Shared client construction options.
   * @returns A client that does not close the supplied transport.
   */
  usingTransport(transport: Transport, options?: ClientOptions): WebClient;
}> = Object.freeze({
  /** Connect with a Node-owned HTTP/2 session. */
  connectTo(baseUrl: string, options: ClientOptions = {}): WebClient {
    const sessions = new Http2SessionManager(baseUrl);
    return WebClient.usingTransport(
      NodeClientTransport.create(createGrpcTransport({ baseUrl, sessionManager: sessions }), () => {
        sessions.abort();
      }),
      options,
    );
  },

  /** Use a caller-owned Connect transport without closing it. */
  usingTransport(transport: Transport, options: ClientOptions = {}): WebClient {
    return WebClient.usingTransport(NodeClientTransport.create(transport), options);
  },
});

/** Creates transport contracts while preserving their ownership boundary. */
const NodeClientTransport = Object.freeze({
  /** Creates a shared transport contract.
   *
   * @param transport - Connect transport used for client operations.
   * @param onClose - Optional cleanup for a transport owned by this package.
   * @returns Shared transport contract with a UUID request-ID source.
   */
  create(transport: Transport, onClose?: () => void): ClientTransport {
    return onClose === undefined
      ? { transport, createRequestId: randomUUID }
      : { transport, createRequestId: randomUUID, close: onClose };
  },
});
