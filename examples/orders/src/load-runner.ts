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

import { randomUUID } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { TypeUrls, AnyMessages } from "@spine-event-engine/core";
import { CommandSchema, UserIdSchema } from "@spine-event-engine/proto";
import { CommandService } from "@spine-event-engine/proto/client";
import { TargetFiltersSchema, TargetSchema } from "@spine-event-engine/proto/client";
import { QueryIdSchema, type QueryResponse, QuerySchema } from "@spine-event-engine/proto/client";
import { QueryService } from "@spine-event-engine/proto/client";
import {
  TopicIdSchema,
  TopicSchema,
  type SubscriptionUpdate,
} from "@spine-event-engine/proto/client";
import { SubscriptionService } from "@spine-event-engine/proto/client";
import { SignalMetadata } from "@spine-event-engine/server";

import { CreateOrderSchema } from "../generated/spine/examples/orders/commands_pb.js";
import { OrderSummarySchema } from "../generated/spine/examples/orders/read_models_pb.js";
import { LatencyDistribution, type LatencyPercentiles } from "./internal/latency-distribution.js";

export type { LatencyPercentiles } from "./internal/latency-distribution.js";

/**
 * Supported independent-user levels for the local datastore-orders scenario.
 */
export const datastoreOrdersLoadLevels = [10, 100, 1000] as const;

/**
 * A supported count of independent users for a load run.
 */
export type DatastoreOrdersLoadLevel = (typeof datastoreOrdersLoadLevels)[number];

/**
 * Configures a datastore-orders load run.
 */
export interface DatastoreOrdersLoadOptions {
  // prettier-ignore

  /**
   * Base URL of the server receiving the load.
   */
  readonly baseUrl: string;

  /**
   * Number of independent users to execute.
   */
  readonly users: DatastoreOrdersLoadLevel;

  /**
   * Maximum duration for each visibility operation, in milliseconds.
   */
  readonly visibilityTimeoutMs?: number;
}

/**
 * Summarizes a completed datastore-orders load run.
 */
export interface DatastoreOrdersLoadResult {
  // prettier-ignore

  /**
   * Number of requested independent users.
   */
  readonly users: number;

  /**
   * Number of users whose command-query-subscription flow rejected.
   */
  readonly failedUsers: number;

  /**
   * Number of users with an acknowledged command.
   */
  readonly commandAcknowledgements: number;

  /**
   * Number of users whose query observed the created order.
   */
  readonly queryVisibilities: number;

  /**
   * Number of users whose subscription delivered the created order.
   */
  readonly subscriptionDeliveries: number;

  /**
   * Percentiles for command acknowledgement latency.
   */
  readonly commandAcknowledgementLatency: LatencyPercentiles;

  /**
   * Percentiles for query visibility latency.
   */
  readonly queryVisibilityLatency: LatencyPercentiles;

  /**
   * Percentiles for subscription delivery latency.
   */
  readonly subscriptionDeliveryLatency: LatencyPercentiles;

  /**
   * Successful user flows per elapsed second.
   */
  readonly throughputPerSecond: number;

  /**
   * Bounded classification of rejected users for diagnostic load runs.
   */
  readonly failureMessages: Readonly<Record<string, number>>;
}

const metadata = new SignalMetadata();
const maximumSharedSessions = 16;
const maximumConcurrentUsers = 10;

/**
 * Executes independent clients through the generated command, query, and subscription services.
 *
 * @param options Server and user-count settings for the run.
 * @returns Aggregate successes, failures, latency percentiles, and throughput.
 */
export async function runDatastoreOrdersLoad(
  options: DatastoreOrdersLoadOptions,
): Promise<DatastoreOrdersLoadResult> {
  return await new DatastoreOrdersLoadRun(options).execute();
}

interface UserResult {
  readonly commandAcknowledgementMs: number;
  readonly queryVisibilityMs: number;
  readonly subscriptionDeliveryMs: number;
}

class DatastoreOrdersLoadRun {
  private readonly timeoutMs: number;
  private readonly sessions: Http2SessionManager[];

  constructor(private readonly options: DatastoreOrdersLoadOptions) {
    this.timeoutMs = options.visibilityTimeoutMs ?? 5_000;
    this.sessions = Array.from(
      { length: Math.min(options.users, maximumSharedSessions) },
      () => new Http2SessionManager(options.baseUrl),
    );
  }

  async execute(): Promise<DatastoreOrdersLoadResult> {
    const startedAt = performance.now();
    try {
      const settled = await this.settleUsers();
      return this.summarize(settled, performance.now() - startedAt);
    } finally {
      for (const session of this.sessions) session.abort();
    }
  }

  private async settleUsers(): Promise<PromiseSettledResult<UserResult>[]> {
    const settled: PromiseSettledResult<UserResult>[] = [];
    for (let firstUser = 0; firstUser < this.options.users; firstUser += maximumConcurrentUsers) {
      const count = Math.min(maximumConcurrentUsers, this.options.users - firstUser);
      const wave = await Promise.allSettled(
        Array.from({ length: count }, (_, offset) => this.runUser(firstUser + offset)),
      );
      settled.push(...wave);
    }
    return settled;
  }

  private runUser(index: number): Promise<UserResult> {
    const session = this.sessions[index % this.sessions.length];
    if (session === undefined) throw new Error("Load runner did not allocate an HTTP/2 session.");
    return new DatastoreOrdersUserRun(
      this.options.baseUrl,
      index,
      this.timeoutMs,
      session,
    ).execute();
  }

  private summarize(
    settled: readonly PromiseSettledResult<UserResult>[],
    elapsedMs: number,
  ): DatastoreOrdersLoadResult {
    const results = settled.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    return {
      users: this.options.users,
      failedUsers: settled.length - results.length,
      commandAcknowledgements: results.length,
      queryVisibilities: results.length,
      subscriptionDeliveries: results.length,
      commandAcknowledgementLatency: LatencyDistribution.from(
        results.map((result) => result.commandAcknowledgementMs),
      ).percentiles(),
      queryVisibilityLatency: LatencyDistribution.from(
        results.map((result) => result.queryVisibilityMs),
      ).percentiles(),
      subscriptionDeliveryLatency: LatencyDistribution.from(
        results.map((result) => result.subscriptionDeliveryMs),
      ).percentiles(),
      throughputPerSecond: elapsedMs === 0 ? 0 : (results.length * 1_000) / elapsedMs,
      failureMessages: this.classifyFailures(settled),
    };
  }

  private classifyFailures(
    settled: readonly PromiseSettledResult<UserResult>[],
  ): Record<string, number> {
    const messages: Record<string, number> = {};
    for (const result of settled) {
      if (result.status !== "rejected") continue;
      const message =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
      messages[message] = (messages[message] ?? 0) + 1;
    }
    return messages;
  }
}

interface SubscriptionRead {
  readonly iterator: AsyncIterator<SubscriptionUpdate>;
  readonly firstUpdate: Promise<IteratorResult<SubscriptionUpdate>>;
}

class DatastoreOrdersUserRun {
  private readonly id: string;
  private readonly actorContext;
  private readonly commands;
  private readonly queries;
  private readonly subscriptions;
  private readonly controller = new AbortController();

  constructor(
    baseUrl: string,
    private readonly index: number,
    private readonly timeoutMs: number,
    session: Http2SessionManager,
  ) {
    const transport = createGrpcTransport({ baseUrl, sessionManager: session });
    this.commands = createClient(CommandService, transport);
    this.queries = createClient(QueryService, transport);
    this.subscriptions = createClient(SubscriptionService, transport);
    this.id = `load-${String(index)}-${randomUUID()}`;
    this.actorContext = metadata.actorContext({
      actor: create(UserIdSchema, { value: `load-user-${String(index)}` }),
    });
  }

  async execute(): Promise<UserResult> {
    let read: SubscriptionRead | undefined;
    try {
      read = await this.startSubscription();
      const submittedAt = performance.now();
      const commandAcknowledgementMs = await this.postCommand(submittedAt);
      const queryVisibilityMs = await this.waitForVisibility(submittedAt);
      const subscriptionDeliveryMs = await this.readSubscription(read.firstUpdate);
      return { commandAcknowledgementMs, queryVisibilityMs, subscriptionDeliveryMs };
    } finally {
      await this.cleanup(read?.iterator);
    }
  }

  private async startSubscription(): Promise<SubscriptionRead> {
    const subscription = await this.withTimeout(
      this.subscriptions.subscribe(this.topic(), {
        signal: this.controller.signal,
      }),
      "subscription creation",
      this.timeoutMs,
      this.controller,
    );
    const iterator = this.subscriptions
      .activate(subscription, { signal: this.controller.signal })
      [Symbol.asyncIterator]();
    const firstUpdate = iterator.next();
    void this.ignoreCancellation(firstUpdate);
    return { iterator, firstUpdate };
  }

  private async postCommand(submittedAt: number): Promise<number> {
    const acknowledgement = await this.withTimeout(
      this.commands.post(this.command(), { signal: this.controller.signal }),
      "command acknowledgement",
      this.timeoutMs,
      this.controller,
    );
    if (acknowledgement.status?.status.case !== "ok")
      throw new Error(
        `CreateOrder acknowledgement was ${acknowledgement.status?.status.case ?? "missing"}.`,
      );
    return performance.now() - submittedAt;
  }

  private command() {
    return create(CommandSchema, {
      id: metadata.commandId(`load-command-${this.id}`),
      context: metadata.commandContext({ actorContext: this.actorContext }),
      message: AnyMessages.pack(
        CreateOrderSchema,
        create(CreateOrderSchema, { id: this.id, skuId: `sku-${String(this.index)}` }),
      ),
    });
  }

  private async waitForVisibility(startedAt: number): Promise<number> {
    const deadline = performance.now() + this.timeoutMs;
    while (performance.now() < deadline) {
      const response = await this.readQuery();
      if (this.isVisible(response)) return performance.now() - startedAt;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`OrderSummary ${this.id} was not visible within ${String(this.timeoutMs)}ms.`);
  }

  private async readQuery() {
    return await this.withTimeout(
      this.queries.read(this.query(), { signal: this.controller.signal }),
      "query visibility read",
      this.timeoutMs,
      this.controller,
    );
  }

  private query() {
    return create(QuerySchema, {
      id: create(QueryIdSchema, { value: `load-query-${this.id}-${randomUUID()}` }),
      target: this.target(),
      context: this.actorContext,
    });
  }

  private isVisible(response: QueryResponse): boolean {
    return (
      response.response?.status?.status.case === "ok" &&
      response.message.some(
        (row) =>
          row.state !== undefined &&
          AnyMessages.unpack(row.state, OrderSummarySchema)?.id === this.id,
      )
    );
  }

  private async readSubscription(
    firstUpdate: Promise<IteratorResult<SubscriptionUpdate>>,
  ): Promise<number> {
    const startedAt = performance.now();
    const update = await this.withTimeout(
      firstUpdate,
      "order subscription update",
      this.timeoutMs,
      this.controller,
    );
    if (update.done) throw new Error("Order subscription ended before its first update.");
    if (!this.isCorrelated(update.value))
      throw new Error(`Order subscription update was not correlated to ${this.id}.`);
    return performance.now() - startedAt;
  }

  private isCorrelated(update: SubscriptionUpdate): boolean {
    return (
      update.update.case === "entityUpdates" &&
      update.update.value.update.some(
        (row) =>
          row.kind.case === "state" &&
          AnyMessages.unpack(row.kind.value, OrderSummarySchema)?.id === this.id,
      )
    );
  }

  private topic() {
    return create(TopicSchema, {
      id: create(TopicIdSchema, { value: `load-topic-${this.id}` }),
      target: this.target(),
      context: this.actorContext,
    });
  }

  private target() {
    return create(TargetSchema, {
      type: TypeUrls.derive(OrderSummarySchema),
      criterion: {
        case: "filters",
        value: create(TargetFiltersSchema, {
          idFilter: {
            id: [
              AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value: this.id })),
            ],
          },
        }),
      },
    });
  }

  private async ignoreCancellation(promise: Promise<unknown>): Promise<void> {
    try {
      await promise;
    } catch {
      // The pending subscription read can reject as expected during cleanup.
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    label: string,
    timeoutMs: number,
    controller?: AbortController,
  ): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            controller?.abort();
            reject(new Error(`${label} timed out after ${String(timeoutMs)}ms.`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  private async cleanup(iterator?: AsyncIterator<SubscriptionUpdate>): Promise<void> {
    this.controller.abort();
    try {
      await this.withTimeout(
        Promise.resolve(iterator?.return?.()).then(() => undefined),
        "subscription cleanup",
        500,
      );
    } catch {
      // Cancellation races are expected after the shared controller is aborted.
    }
  }
}
