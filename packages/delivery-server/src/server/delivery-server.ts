import * as http2 from "node:http2";
import type { AddressInfo } from "node:net";

import { connectNodeAdapter } from "@connectrpc/connect-node";

import {
  AdminService,
  Health,
  InboxService,
  ShardService,
} from "@spine-event-engine/proto/delivery-server";
import { createHealthService } from "../health/health-service.js";
import { createDeliveryAssembly } from "./assembly.js";
import { resolveConfiguration } from "./config.js";
import { runDeliveryServerShutdown } from "./shutdown.js";

/** Construction-time configuration for {@link DeliveryServer}. */
export interface DeliveryServerOptions {
  /**
   * Listener host. The explicit option overrides `HOST`; the default is the
   * local-only address `127.0.0.1`. Blank values are rejected.
   */
  readonly host?: string;
  /**
   * Listener port. The explicit option overrides `PORT`; the default is `8484`.
   * Accepts integers from `0` through `65535`; zero requests an ephemeral port.
   */
  readonly port?: number;
  /**
   * Maximum inbound RPC message size in bytes. The explicit option overrides
   * `MAX_INBOUND_MESSAGE_SIZE`; the default is 4 MiB (`4_194_304`). Accepts
   * positive integers through `2_147_483_647`.
   */
  readonly maxInboundMessageBytes?: number;
  /**
   * Automatic stale-pickup timeout in seconds. The explicit option overrides
   * `SHARD_PROCESSING_TIMEOUT`; the default is zero (disabled). Accepts
   * non-negative integers through `2_147_483_647`.
   */
  readonly processingTimeoutSeconds?: number;
  /**
   * Maximum retained Inbox records. The explicit option overrides
   * `MAX_RETAINED_MESSAGES`; the default is `10_000`. Accepts integers from 1
   * through `2_147_483_647`.
   */
  readonly maxRetainedMessages?: number;
  /**
   * Maximum serialized bytes retained across Inbox records. The explicit option
   * overrides `MAX_RETAINED_BYTES`; the default is 32 MiB (`33_554_432`).
   * Accepts integers from 1 through `2_147_483_647`.
   */
  readonly maxRetainedBytes?: number;
  /**
   * Maximum distinct shards retained by messages or pickup sessions. The
   * explicit option overrides `MAX_TRACKED_SHARDS`; the default is `1_000`.
   * Accepts integers from 1 through `1_000`.
   */
  readonly maxTrackedShards?: number;
}

/** A small in-memory Connect listener for the frozen delivery simple-server API. */
export class DeliveryServer {
  /** Configured listener host, resolved and validated during construction. */
  readonly host: string;
  #port: number;
  readonly #configuration: ReturnType<typeof resolveConfiguration>;
  #server: http2.Http2Server | undefined;
  #start: Promise<this> | undefined;
  #close: Promise<void> | undefined;
  #started = false;
  #serving = true;
  #assembly: ReturnType<typeof createDeliveryAssembly> | undefined;
  readonly #sessions = new Set<http2.ServerHttp2Session>();

  /**
   * Creates a terminal-lifecycle server and resolves configuration exactly once.
   *
   * Invalid options or environment values fail synchronously before any listener
   * is created or bound.
   */
  constructor(options: DeliveryServerOptions = {}) {
    this.#configuration = resolveConfiguration(options);
    this.host = this.#configuration.host;
    this.#port = this.#configuration.port;
  }

  /**
   * Configured port before startup, or the actual bound port after a successful
   * ephemeral (`0`) bind.
   */
  get port(): number {
    return this.#port;
  }

  /**
   * Configured HTTP base URL of the running cleartext HTTP/2 listener.
   *
   * @throws If read before startup completes successfully.
   */
  get baseUrl(): string {
    if (!this.#started) throw new Error("Delivery server has not started.");
    return `http://${this.host.includes(":") ? `[${this.host}]` : this.host}:${String(this.#port)}`;
  }

  /**
   * Starts the listener once.
   *
   * Concurrent and repeated calls share the same promise and listener. A failed
   * or closed instance is terminal and cannot retry startup.
   */
  start(): Promise<this> {
    if (this.#close !== undefined) return Promise.reject(new Error("Delivery server is closed."));
    if (this.#start !== undefined) return this.#start;
    this.#start = this.#startOnce();
    return this.#start;
  }

  /**
   * Runs ordered terminal shutdown once.
   *
   * Concurrent and repeated calls share one promise. Closing before startup
   * prevents binding; closing during startup waits for reached-resource cleanup.
   */
  close(): Promise<void> {
    if (this.#close !== undefined) return this.#close;
    this.#close = runDeliveryServerShutdown({
      markNotServing: () => {
        this.#serving = false;
      },
      closeAdmission: () => {
        this.#assembly?.closeAdmission();
      },
      closeAdmin: () => {
        this.#assembly?.closeAdmin();
      },
      closeNetwork: async () => {
        try {
          await this.#start;
        } catch {
          // A failed listener has already reached its terminal state.
        }
        const server = this.#server;
        if (server?.listening) {
          const closing = closeServer(server);
          for (const session of this.#sessions) session.close();
          await closing;
        }
      },
    });
    return this.#close;
  }

  async #startOnce(): Promise<this> {
    const core = createDeliveryAssembly(this.#configuration);
    this.#assembly = core;
    const server = http2.createServer(
      connectNodeAdapter({
        routes: (router) => {
          router.service(InboxService, core.inbox);
          router.service(ShardService, core.shards);
          router.service(AdminService, core.admin);
          router.service(
            Health,
            createHealthService(() => this.#serving),
          );
        },
        readMaxBytes: this.#configuration.maxInboundMessageBytes,
      }),
    );
    server.on("session", (session) => {
      this.#sessions.add(session);
      session.on("close", () => this.#sessions.delete(session));
    });
    this.#server = server;
    try {
      const address = await listen(server, this.host, this.#port);
      this.#port = address.port;
      this.#started = true;
      return this;
    } catch (error) {
      await closeServer(server);
      throw error;
    }
  }
}

function listen(server: http2.Http2Server, host: string, port: number): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    const done = () => {
      server.off("error", fail);
      server.off("listening", ready);
    };
    const fail = (error: Error) => {
      done();
      reject(error);
    };
    const ready = () => {
      done();
      resolve(server.address() as AddressInfo);
    };
    server.once("error", fail);
    server.once("listening", ready);
    server.listen(port, host);
  });
}

function closeServer(server: http2.Http2Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}
