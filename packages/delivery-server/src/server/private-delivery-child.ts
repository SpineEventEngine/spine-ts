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
import type { Timestamp } from "@bufbuild/protobuf/wkt";

import {
  Code,
  ConnectError,
  type ConnectRouter,
  type Interceptor,
  type ServiceImpl,
  type HandlerContext,
} from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { Time } from "@spine-event-engine/core/time";
import {
  AdminService,
  GuardedInboxService,
  InboxService,
  ManagedShardService,
  ShardObservingService,
  ShardService,
  type DeliveryShardPickup,
  type DeliverySessionHandle,
} from "@spine-event-engine/proto/delivery-server";
import * as privateProto from "@spine-event-engine/proto/generated/spine/delivery/session/private_delivery_pb.js";

import { InboxMessages, InboxShards } from "../core/inbox-service.js";
import { DeliverySessionInputs } from "../core/shard-service.js";
import type { CapacityTicket, CapacityUsage } from "./capacity-ledger.js";
import { CapacityMutationGate } from "./capacity-mutation-gate.js";
import { CapacityUsageReporter } from "./capacity-usage-reporter.js";
import { DeliveryAssembly } from "./assembly.js";
import type { DeliveryConfiguration } from "./config.js";
import { PrivateCapacityClient } from "./private-capacity-client.js";

const noGrowth: CapacityUsage = Object.freeze({ rows: 0, bytes: 0, shards: 0 });

/**
 * Configures one authenticated child process with one fixed route slot.
 */
export interface PrivateDeliveryChildOptions {
  /**
   * Identifies the fixed shard route slot.
   */
  readonly slot: number;

  /**
   * Distinguishes this process from later replacements in the slot.
   */
  readonly generation: string;

  /**
   * Authenticates parent requests on the child listener.
   */
  readonly credential: string;

  /**
   * Authenticates child capacity reports on the parent's listener.
   */
  readonly capacityCredential: string;

  /**
   * Identifies the parent's private capacity listener.
   */
  readonly capacityBaseUrl: string;

  /**
   * Preserves the configured delivery limits and session lifetime.
   */
  readonly configuration: DeliveryConfiguration;
}

/**
 * Serves one slot's in-memory Delivery services on an authenticated loopback listener.
 */
export class PrivateDeliveryChild {
  /**
   * Calls the parent capacity ledger through authenticated private gRPC.
   */
  readonly #capacity: PrivateCapacityClient;

  /**
   * Serializes capacity-changing requests in this process.
   */
  readonly #gate: CapacityMutationGate;

  /**
   * Retries autonomous expiry reports until acknowledged.
   */
  readonly #reporter: CapacityUsageReporter;

  /**
   * Holds the canonical rows, sessions, and service handlers.
   */
  readonly #assembly: DeliveryAssembly;

  /**
   * Accepts authenticated private gRPC calls.
   */
  readonly #server: http2.Http2Server;

  /**
   * Tracks HTTP/2 sessions for listener shutdown.
   */
  readonly #sessions = new Set<http2.ServerHttp2Session>();

  /**
   * Holds the ephemeral port after startup.
   */
  #port: number | undefined;

  /**
   * Shares the listener bind attempt.
   */
  #start: Promise<void> | undefined;

  /**
   * Shares terminal shutdown.
   */
  #close: Promise<void> | undefined;

  /**
   * Creates a child listener and its private capacity client without binding.
   *
   * @param options Supplies the fixed slot, generation, credentials, and limits.
   * @param onFatal Ends the child process after a terminal capacity-report failure.
   */
  constructor(
    private readonly options: PrivateDeliveryChildOptions,
    private readonly onFatal?: () => void,
  ) {
    this.#capacity = new PrivateCapacityClient(
      options.capacityBaseUrl,
      options.capacityCredential,
      options.slot,
      options.generation,
    );
    this.#gate = new CapacityMutationGate(this.#capacity);
    this.#reporter = new CapacityUsageReporter((snapshot) => this.#capacity.reportUsage(snapshot));
    this.#assembly = DeliveryAssembly.create({
      ...options.configuration,
      onAutonomousExpiry: (snapshot) => {
        void this.#reporter.publish(snapshot).catch(() => {
          void this.close().finally(() => {
            this.onFatal?.();
          });
        });
      },
    });
    this.#server = this.#createServer();
  }

  /**
   * Creates the authenticated private listener for this child generation.
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
   * Registers state and lifecycle services on the private listener.
   *
   * @param router Registers the child gRPC descriptors.
   */
  #routes(router: ConnectRouter): void {
    router.service(InboxService, this.#inbox());
    router.service(ShardService, this.#shards());
    router.service(ManagedShardService, this.#managed());
    router.service(GuardedInboxService, this.#guarded());
    router.service(AdminService, this.#assembly.admin);
    router.service(ShardObservingService, this.#assembly.observing);
    router.service(privateProto.PrivateChildService, {
      barrier: async (request) => {
        await this.#gate.barrier({
          slot: Number(request.slot),
          generation: request.generation,
          sequence: request.sequence,
        });
        return {};
      },
    });
  }

  /**
   * Returns the private loopback endpoint after this child has started.
   *
   * @returns The base URL for parent-to-child gRPC calls.
   */
  get baseUrl(): string {
    if (this.#port === undefined) throw new Error("Private Delivery child has not started.");
    return `http://127.0.0.1:${String(this.#port)}`;
  }

  /**
   * Binds the child listener to an ephemeral loopback port.
   *
   * @returns Completion after the child accepts private requests.
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
   * Stops admission, observation, and both private transports once.
   *
   * @returns Completion after the child listener closes.
   */
  close(): Promise<void> {
    this.#close ??= (async () => {
      this.#assembly.closeAdmission();
      this.#assembly.closeAdmin();
      this.#assembly.closeObserving();
      this.#assembly.closeSessions();
      this.#gate.close();
      this.#reporter.close();
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
      this.#capacity.close();
    })();
    return this.#close;
  }

  /**
   * Wraps Inbox mutations with exact capacity reservation.
   *
   * @returns The private Inbox handlers.
   */
  #inbox(): ServiceImpl<typeof InboxService> {
    return {
      writeOne: (request, context) =>
        this.#mutate(
          context.requestHeader,
          context.signal,
          () => this.#growth([InboxMessages.required(request.message)]),
          () => Promise.resolve(this.#assembly.inbox.writeOne(request, context)),
        ),
      writeMany: (request, context) =>
        this.#mutate(
          context.requestHeader,
          context.signal,
          () => this.#batchGrowth(request),
          () => Promise.resolve(this.#assembly.inbox.writeMany(request, context)),
        ),
      removeOne: (request, context) =>
        this.#mutate(
          context.requestHeader,
          context.signal,
          () => noGrowth,
          () => Promise.resolve(this.#assembly.inbox.removeOne(request, context)),
        ),
      removeMany: (request, context) =>
        this.#mutate(
          context.requestHeader,
          context.signal,
          () => noGrowth,
          () => Promise.resolve(this.#assembly.inbox.removeMany(request, context)),
        ),
      findOne: this.#assembly.inbox.findOne,
      findManyInShard: this.#assembly.inbox.findManyInShard,
      newestMessageToDeliver: this.#assembly.inbox.newestMessageToDeliver,
    };
  }

  /**
   * Validates one batch's shard identity before reserving final-state growth.
   *
   * @param request Supplies the Inbox write batch.
   * @returns Possible positive capacity growth.
   */
  #batchGrowth(
    request: Parameters<ServiceImpl<typeof InboxService>["writeMany"]>[0],
  ): CapacityUsage {
    const shard = InboxShards.required(request.shard);
    InboxMessages.requiredBatchLength(request.message.length);
    const records = request.message.map(InboxMessages.required);
    InboxShards.ensure(
      records.map((record) => record.message),
      shard,
    );
    return this.#growth(records);
  }

  /**
   * Wraps the raw shard service's global inactivity release in one child ticket.
   *
   * @returns The raw shard operations for this slot.
   */
  #shards(): ServiceImpl<typeof ShardService> {
    const source = this.#assembly.shards;
    return {
      pickShard: source.pickShard,
      releaseSession: source.releaseSession,
      releaseSessions: (request, context) =>
        this.#mutate(
          context.requestHeader,
          context.signal,
          () => noGrowth,
          () => Promise.resolve(source.releaseSessions(request, context)),
        ),
    };
  }

  /**
   * Wraps typed session mutations with one correlated capacity ticket each.
   *
   * @returns The typed shard operations for this slot.
   */
  #managed(): ServiceImpl<typeof ManagedShardService> {
    const source = this.#assembly.managed;
    return {
      pickShardRaw: (request, context) =>
        this.#mutate(
          context.requestHeader,
          context.signal,
          () => this.#pickupGrowth(request, "RAW"),
          () => Promise.resolve(source.pickShardRaw(request, context)),
        ),
      pickShardForDelivery: (request, context) =>
        this.#mutate(
          context.requestHeader,
          context.signal,
          () => this.#pickupGrowth(request, "MANAGED"),
          () => Promise.resolve(source.pickShardForDelivery(request, context)),
        ),
      renewShardSession: (request, context) =>
        this.#sessionChange(request, context, (revision) =>
          this.#assembly.sessionRuntime.renewAtRevision(request, context.signal, revision),
        ),
      releaseShardSession: (request, context) =>
        this.#sessionChange(request, context, (revision) =>
          this.#assembly.sessionRuntime.releaseAtRevision(request, context.signal, revision),
        ),
    };
  }

  /**
   * Captures a session revision before waiting on the private capacity gate.
   *
   * @typeParam T The typed session response.
   * @param request Supplies the received session handle.
   * @param context Carries the public signal and private ticket.
   * @param apply Changes only the captured revision after capacity admission.
   * @returns The typed session response.
   */
  #sessionChange<T>(
    request: DeliverySessionHandle,
    context: HandlerContext,
    apply: (revision: number | undefined) => Promise<T>,
  ): Promise<T> {
    const revision = this.#assembly.sessionRuntime.receivedRevision(request.shard);
    return this.#mutate(
      context.requestHeader,
      context.signal,
      () => noGrowth,
      () => apply(revision),
    );
  }

  /**
   * Plans and applies guarded acknowledgement with one server timestamp sample.
   *
   * @returns The session-guarded Inbox handlers for this slot.
   */
  #guarded(): ServiceImpl<typeof GuardedInboxService> {
    const source = this.#assembly.guarded;
    return {
      acknowledge: (request, context) => this.#acknowledge(request, context),
      removePendingDuplicate: (request, context) =>
        this.#mutate(
          context.requestHeader,
          context.signal,
          () => noGrowth,
          () => Promise.resolve(source.removePendingDuplicate(request, context)),
        ),
      removeExpiredDelivered: (request, context) =>
        this.#mutate(
          context.requestHeader,
          context.signal,
          () => noGrowth,
          () => Promise.resolve(source.removeExpiredDelivered(request, context)),
        ),
    };
  }

  /**
   * Uses one timestamp for exact byte growth and first completion deadline.
   *
   * @param request Supplies the session and original decoded row.
   * @param context Carries the ticket and cancellation signal.
   * @returns The matched acknowledgement result.
   */
  #acknowledge(
    request: Parameters<ServiceImpl<typeof GuardedInboxService>["acknowledge"]>[0],
    context: Parameters<ServiceImpl<typeof GuardedInboxService>["acknowledge"]>[1],
  ) {
    let sampled: Timestamp | undefined;
    const plan = () => {
      sampled = Time.currentTime();
      return this.#positive(
        this.#assembly.guardedRuntime.projectedAcknowledgement(request, sampled),
      );
    };
    return this.#mutate(
      context.requestHeader,
      context.signal,
      plan,
      () => {
        if (sampled === undefined) throw new Error("Acknowledgement time was not sampled.");
        return this.#assembly.guardedRuntime.acknowledgeAt(request, context.signal, sampled);
      },
      plan,
    );
  }

  /**
   * Reserves tracked-shard capacity only when a pickup can add a new shard.
   *
   * @param request Supplies the validated shard and worker.
   * @param kind Distinguishes raw pickup from work-aware pickup.
   * @returns Possible positive growth before the pickup runs.
   */
  #pickupGrowth(request: DeliveryShardPickup, kind: "RAW" | "MANAGED"): CapacityUsage {
    const shard = DeliverySessionInputs.requireShard(request.shard);
    DeliverySessionInputs.requireWorker(request.worker);
    if (this.#assembly.state.tracks(shard)) return noGrowth;
    if (kind === "MANAGED" && !this.#assembly.state.hasPending(shard)) return noGrowth;
    return { rows: 0, bytes: 0, shards: 1 };
  }

  /**
   * Calculates only positive growth from the final state of one write batch.
   *
   * @param records Supplies validated wire rows.
   * @returns Rows, bytes, and tracked shards requiring parent capacity.
   */
  #growth(records: readonly ReturnType<typeof InboxMessages.required>[]): CapacityUsage {
    return this.#positive(this.#assembly.state.projectedUsage(records));
  }

  /**
   * Counts only positive row, byte, and shard changes against current child state.
   *
   * @param projected Supplies the final state totals for one mutation.
   * @returns The global headroom required before commit.
   */
  #positive(projected: CapacityUsage): CapacityUsage {
    const prior = this.#assembly.state.usage();
    return {
      rows: Math.max(0, projected.rows - prior.rows),
      bytes: Math.max(0, projected.bytes - prior.bytes),
      shards: Math.max(0, projected.shards - prior.shards),
    };
  }

  /**
   * Reads the parent-issued mutation sequence after private authentication.
   *
   * @param headers Carries the correlated ticket sequence.
   * @returns The complete child generation ticket.
   */
  #ticket(headers: Headers): CapacityTicket {
    const sequence = headers.get("x-spine-capacity-sequence");
    if (sequence === null || !/^[1-9][0-9]*$/.test(sequence))
      throw new ConnectError("Private Delivery capacity ticket is missing.", Code.InvalidArgument);
    return {
      slot: this.options.slot,
      generation: this.options.generation,
      sequence: BigInt(sequence),
    };
  }

  /**
   * Applies a capacity-changing handler with a report of exact final usage.
   *
   * @typeParam T The service handler result.
   * @param headers Carries the correlated ticket.
   * @param signal Cancels before mutation admission.
   * @param growth Calculates positive growth at admission time.
   * @param operation Applies the existing service handler.
   * @returns The service handler result.
   */
  #mutate<T>(
    headers: Headers,
    signal: AbortSignal,
    growth: () => CapacityUsage,
    operation: () => Promise<T>,
    refresh?: () => CapacityUsage,
  ): Promise<T> {
    return this.#gate.run(
      this.#ticket(headers),
      growth,
      operation,
      () => this.#assembly.state.usageSnapshot(),
      signal,
      refresh,
    );
  }
}
