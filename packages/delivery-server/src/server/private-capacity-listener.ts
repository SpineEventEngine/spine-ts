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

import * as http2 from "node:http2";
import type { AddressInfo } from "node:net";

import { connectNodeAdapter } from "@connectrpc/connect-node";
import * as privateProto from "@spine-event-engine/proto/generated/spine/delivery/session/private_delivery_pb.js";

import { CapacityLedger } from "./capacity-ledger.js";
import { PrivateCapacityHandlers, type ChildCredential } from "./private-capacity-service.js";

/**
 * Serves capacity admission on a private loopback endpoint.
 */
export class PrivateCapacityListener {
  readonly #server: http2.Http2Server;

  readonly #sessions = new Set<http2.ServerHttp2Session>();

  #port: number | undefined;

  #start: Promise<void> | undefined;

  #close: Promise<void> | undefined;

  /**
   * Creates the authenticated private service without opening a listener.
   *
   * @param ledger Applies server-wide retained-state limits.
   * @param credentials Identifies live child process generations.
   */
  constructor(ledger: CapacityLedger, credentials: ReadonlyMap<string, ChildCredential>) {
    const handlers = new PrivateCapacityHandlers(ledger, credentials);
    this.#server = http2.createServer(
      connectNodeAdapter({
        routes: (router) => router.service(privateProto.PrivateCapacityService, handlers.service()),
      }),
    );
    this.#server.on("session", (session) => {
      this.#sessions.add(session);
      session.on("close", () => this.#sessions.delete(session));
    });
  }

  /**
   * Returns the private endpoint after the listener has started.
   *
   * @returns A loopback URL used only by delivery child processes.
   */
  get baseUrl(): string {
    if (this.#port === undefined) throw new Error("Private capacity listener has not started.");
    return `http://127.0.0.1:${String(this.#port)}`;
  }

  /**
   * Binds an ephemeral loopback port once.
   *
   * @returns Completion after the private listener accepts requests.
   */
  start(): Promise<void> {
    if (this.#close !== undefined)
      return Promise.reject(new Error("Private capacity listener is closed."));
    this.#start ??= new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => {
        this.#server.off("listening", ready);
        reject(error);
      };
      const ready = () => {
        this.#server.off("error", fail);
        this.#port = (this.#server.address() as AddressInfo).port;
        resolve();
      };
      this.#server.once("error", fail);
      this.#server.once("listening", ready);
      this.#server.listen(0, "127.0.0.1");
    });
    return this.#start;
  }

  /**
   * Stops the listener and closes active HTTP/2 sessions once.
   *
   * @returns Completion after the socket is closed.
   */
  close(): Promise<void> {
    this.#close ??= (async () => {
      try {
        await this.#start;
      } catch {
        // A failed bind has no listening socket to close.
      }
      if (!this.#server.listening) return;
      const closed = new Promise<void>((resolve, reject) => {
        this.#server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      });
      for (const session of this.#sessions) session.close();
      await closed;
    })();
    return this.#close;
  }
}
