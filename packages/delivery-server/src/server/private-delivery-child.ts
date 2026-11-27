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
import { Code, ConnectError, type ConnectRouter, type Interceptor } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import {
  AdminService,
  InboxService,
  ShardObservingService,
  ShardService,
} from "@spine-event-engine/proto/delivery-server";

import { DeliveryAssembly } from "./assembly.js";
import type { DeliveryConfiguration } from "./config.js";

/**
 * Configures one authenticated child listener.
 */
export interface PrivateDeliveryChildOptions {
  /**
   * Authenticates parent requests on the child listener.
   */
  readonly credential: string;

  /**
   * Preserves local session lifetime and transport settings.
   */
  readonly configuration: DeliveryConfiguration;
}

/**
 * Serves one slot's in-memory Delivery services on an authenticated loopback listener.
 */
export class PrivateDeliveryChild {
  readonly #assembly: DeliveryAssembly;

  readonly #server: http2.Http2Server;

  readonly #sessions = new Set<http2.ServerHttp2Session>();

  #port: number | undefined;

  #start: Promise<void> | undefined;

  #close: Promise<void> | undefined;

  /**
   * Creates a child listener without binding it.
   *
   * @param options Supplies the private credential and local settings.
   */
  constructor(private readonly options: PrivateDeliveryChildOptions) {
    this.#assembly = DeliveryAssembly.create(options.configuration);
    this.#server = this.#createServer();
  }

  /**
   * Creates the authenticated loopback listener.
   *
   * @returns The unbound HTTP/2 server.
   */
  #createServer(): http2.Http2Server {
    const authenticate: Interceptor = (next) => async (request) => {
      if (request.header.get("authorization") !== this.options.credential)
        throw new ConnectError(
          "Private Delivery child credential is invalid.",
          Code.Unauthenticated,
        );
      return next(request);
    };
    const server = http2.createServer(
      connectNodeAdapter({
        interceptors: [authenticate],
        routes: (router) => {
          this.#routes(router);
        },
        readMaxBytes: this.options.configuration.maxInboundMessageBytes,
        writeMaxBytes: this.options.configuration.maxOutboundMessageBytes,
      }),
    );
    server.on("session", (session) => {
      this.#sessions.add(session);
      session.on("close", () => {
        this.#sessions.delete(session);
      });
    });
    return server;
  }

  /**
   * Registers business services over the child's local state and admission queue.
   *
   * @param router Registers the child gRPC descriptors.
   */
  #routes(router: ConnectRouter): void {
    router.service(InboxService, this.#assembly.inbox);
    router.service(ShardService, this.#assembly.shards);
    router.service(AdminService, this.#assembly.admin);
    router.service(ShardObservingService, this.#assembly.observing);
  }

  /**
   * Returns the private endpoint after startup.
   *
   * @returns The base URL for parent-to-child gRPC calls.
   */
  get baseUrl(): string {
    if (this.#port === undefined) throw new Error("Private Delivery child has not started.");
    return `http://127.0.0.1:${String(this.#port)}`;
  }

  /**
   * Binds the listener to an ephemeral loopback port.
   *
   * @returns Completion after the child accepts requests.
   */
  start(): Promise<void> {
    if (this.#close !== undefined)
      return Promise.reject(new Error("Private Delivery child is closed."));
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
   * Stops admission, observation, sessions, and the private listener once.
   *
   * @returns Completion after the child listener closes.
   */
  close(): Promise<void> {
    this.#close ??= (async () => {
      this.#assembly.closeAdmission();
      this.#assembly.closeAdmin();
      this.#assembly.closeObserving();
      try {
        await this.#start;
      } catch {
        /* A failed bind has no active listener. */
      }
      if (this.#server.listening) {
        const closing = new Promise<void>((resolve, reject) => {
          this.#server.close((error) => {
            if (error === undefined) resolve();
            else reject(error);
          });
        });
        for (const session of this.#sessions) session.close();
        await closing;
      }
    })();
    return this.#close;
  }
}
