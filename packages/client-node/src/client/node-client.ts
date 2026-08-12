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

import { Http2SessionManager, createGrpcTransport } from "@connectrpc/connect-node";
import { randomUUID } from "node:crypto";
import {
  Client as WebClient,
  type ClientOptions,
  type ClientTransport,
} from "@spine-event-engine/client-web";
import type { Transport } from "@connectrpc/connect";

/**
 * Creates Node transport-backed instances of the shared browser-safe client kernel.
 */
export const Client: Readonly<{
  // prettier-ignore

  /**
   * Connects through a Node-owned HTTP/2 session.
   *
   * @param baseUrl Gateway base URL.
   * @param options Shared client construction options.
   * @returns A client that closes its owned HTTP/2 session.
   */
  connectTo(baseUrl: string, options?: ClientOptions): WebClient;

  /**
   * Uses a caller-owned Connect transport.
   *
   * @param transport Connect transport that remains caller-owned.
   * @param options Shared client construction options.
   * @returns A client that does not close the supplied transport.
   */
  usingTransport(transport: Transport, options?: ClientOptions): WebClient;
}> = Object.freeze({
  // prettier-ignore

  /**
   * Connect with a Node-owned HTTP/2 session.
   */
  connectTo(baseUrl: string, options: ClientOptions = {}): WebClient {
    const sessions = new Http2SessionManager(baseUrl);
    return WebClient.usingTransport(
      NodeClientTransport.create(createGrpcTransport({ baseUrl, sessionManager: sessions }), () => {
        sessions.abort();
      }),
      options,
    );
  },

  /**
   * Use a caller-owned Connect transport without closing it.
   */
  usingTransport(transport: Transport, options: ClientOptions = {}): WebClient {
    return WebClient.usingTransport(NodeClientTransport.create(transport), options);
  },
});

/**
 * Creates transport contracts while preserving their ownership boundary.
 */
const NodeClientTransport = Object.freeze({
  // prettier-ignore

  /**
   * Creates a shared transport contract.
   *
   * @param transport Connect transport used for client operations.
   * @param onClose Optional cleanup for a transport owned by this package.
   * @returns Shared transport contract with a UUID request-ID source.
   */
  create(transport: Transport, onClose?: () => void): ClientTransport {
    return onClose === undefined
      ? { transport, createRequestId: randomUUID }
      : { transport, createRequestId: randomUUID, close: onClose };
  },
});
