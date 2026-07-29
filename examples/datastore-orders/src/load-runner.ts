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

import { CreateOrderSchema } from "../generated/spine/example/datastore_orders/v1/commands_pb.js";
import { OrderSummarySchema } from "../generated/spine/example/datastore_orders/v1/read_models_pb.js";

/** Supported independent-user levels for the local datastore-orders scenario. */
export const datastoreOrdersLoadLevels = [10, 100, 1000] as const;
export type DatastoreOrdersLoadLevel = (typeof datastoreOrdersLoadLevels)[number];

export interface DatastoreOrdersLoadOptions {
  readonly baseUrl: string;
  readonly users: DatastoreOrdersLoadLevel;
  readonly visibilityTimeoutMs?: number;
}

export interface LatencyPercentiles {
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
}
export interface DatastoreOrdersLoadResult {
  readonly users: number;
  readonly failedUsers: number;
  readonly commandAcknowledgements: number;
  readonly queryVisibilities: number;
  readonly subscriptionDeliveries: number;
  readonly commandAcknowledgementLatency: LatencyPercentiles;
  readonly queryVisibilityLatency: LatencyPercentiles;
  readonly subscriptionDeliveryLatency: LatencyPercentiles;
  readonly throughputPerSecond: number;
  /** Bounded classification of rejected users for diagnostic load runs. */
  readonly failureMessages: Readonly<Record<string, number>>;
}

const metadata = new SignalMetadata();
const maximumSharedSessions = 16;
const maximumConcurrentUsers = 10;

/** Runs independent clients through the generated command, query, and subscription services. */
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
      return summarize(this.options.users, settled, performance.now() - startedAt);
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
    return runUser(this.options.baseUrl, index, this.timeoutMs, session);
  }
}

function summarize(
  users: number,
  settled: readonly PromiseSettledResult<UserResult>[],
  elapsedMs: number,
): DatastoreOrdersLoadResult {
  const results = settled.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  return {
    users,
    failedUsers: settled.length - results.length,
    commandAcknowledgements: results.length,
    queryVisibilities: results.length,
    subscriptionDeliveries: results.length,
    commandAcknowledgementLatency: percentiles(
      results.map((result) => result.commandAcknowledgementMs),
    ),
    queryVisibilityLatency: percentiles(results.map((result) => result.queryVisibilityMs)),
    subscriptionDeliveryLatency: percentiles(
      results.map((result) => result.subscriptionDeliveryMs),
    ),
    throughputPerSecond: elapsedMs === 0 ? 0 : (results.length * 1_000) / elapsedMs,
    failureMessages: classifyFailures(settled),
  };
}

function classifyFailures(
  settled: readonly PromiseSettledResult<UserResult>[],
): Record<string, number> {
  const messages: Record<string, number> = {};
  for (const result of settled) {
    if (result.status !== "rejected") continue;
    const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
    messages[message] = (messages[message] ?? 0) + 1;
  }
  return messages;
}

async function runUser(
  baseUrl: string,
  index: number,
  timeoutMs: number,
  session: Http2SessionManager,
): Promise<UserResult> {
  return await new DatastoreOrdersUserRun(baseUrl, index, timeoutMs, session).execute();
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
    const subscription = await withTimeout(
      this.subscriptions.subscribe(topic(this.id, this.actorContext), {
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
    void ignoreCancellation(firstUpdate);
    return { iterator, firstUpdate };
  }

  private async postCommand(submittedAt: number): Promise<number> {
    const acknowledgement = await withTimeout(
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
    return await withTimeout(
      this.queries.read(this.query(), { signal: this.controller.signal }),
      "query visibility read",
      this.timeoutMs,
      this.controller,
    );
  }

  private query() {
    return create(QuerySchema, {
      id: create(QueryIdSchema, { value: `load-query-${this.id}-${randomUUID()}` }),
      target: target(this.id),
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
    const update = await withTimeout(
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

  private async cleanup(iterator?: AsyncIterator<SubscriptionUpdate>): Promise<void> {
    this.controller.abort();
    try {
      await withTimeout(
        Promise.resolve(iterator?.return?.()).then(() => undefined),
        "subscription cleanup",
        500,
      );
    } catch {
      // Cancellation races are expected after the shared controller is aborted.
    }
  }
}

function topic(id: string, actorContext: ReturnType<typeof metadata.actorContext>) {
  return create(TopicSchema, {
    id: create(TopicIdSchema, { value: `load-topic-${id}` }),
    target: target(id),
    context: actorContext,
  });
}
function target(id: string) {
  return create(TargetSchema, {
    type: TypeUrls.derive(OrderSummarySchema),
    criterion: {
      case: "filters",
      value: create(TargetFiltersSchema, {
        idFilter: {
          id: [AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value: id }))],
        },
      }),
    },
  });
}
function percentiles(values: readonly number[]): LatencyPercentiles {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
  };
}
function percentile(sorted: readonly number[], ratio: number): number {
  return sorted.length === 0
    ? 0
    : (sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0);
}
async function ignoreCancellation(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    // The pending subscription read can reject as expected during cleanup.
  }
}

async function withTimeout<T>(
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
