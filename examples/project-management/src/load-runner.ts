import { randomUUID } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { deriveTypeUrl, packAny, unpackAny } from "@spine-ts/core";
import { CommandSchema, UserIdSchema } from "@spine-ts/proto";
import { CommandService } from "@spine-ts/proto/client";
import { TargetFiltersSchema, TargetSchema } from "@spine-ts/proto/client";
import { QueryIdSchema, QuerySchema } from "@spine-ts/proto/client";
import { QueryService } from "@spine-ts/proto/client";
import { TopicIdSchema, TopicSchema, type SubscriptionUpdate } from "@spine-ts/proto/client";
import { SubscriptionService } from "@spine-ts/proto/client";
import { SignalMetadata } from "@spine-ts/server";

import { CreateProjectSchema } from "../generated/spine/example/project_management/v1/commands_pb.js";
import { ProjectSummarySchema } from "../generated/spine/example/project_management/v1/read_models_pb.js";

/** Supported independent-user levels for repeatable local load scenarios. */
export const projectManagementLoadLevels = [10, 25, 50, 100] as const;

export type ProjectManagementLoadLevel = (typeof projectManagementLoadLevels)[number];

export interface ProjectManagementLoadOptions {
  readonly baseUrl: string;
  readonly users: ProjectManagementLoadLevel;
  readonly visibilityTimeoutMs?: number;
}

export interface LatencyPercentiles {
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
}

export interface ProjectManagementLoadResult {
  readonly users: number;
  readonly failedUsers: number;
  readonly commandAcknowledgements: number;
  readonly queryVisibilities: number;
  readonly subscriptionDeliveries: number;
  readonly commandAcknowledgementLatency: LatencyPercentiles;
  readonly queryVisibilityLatency: LatencyPercentiles;
  readonly subscriptionDeliveryLatency: LatencyPercentiles;
  readonly throughputPerSecond: number;
}

const metadata = new SignalMetadata();

/**
 * Run independent asynchronous users against the real generated gRPC services.
 * Every user owns and closes its own HTTP/2 session and subscription iterator.
 */
export async function runProjectManagementLoad(
  options: ProjectManagementLoadOptions,
): Promise<ProjectManagementLoadResult> {
  const visibilityTimeoutMs = options.visibilityTimeoutMs ?? 5_000;
  const startedAt = performance.now();
  const settled = await Promise.allSettled(
    Array.from({ length: options.users }, (_, index) =>
      runUser(options.baseUrl, index, visibilityTimeoutMs),
    ),
  );
  const elapsedMs = performance.now() - startedAt;
  const results = settled.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );

  return {
    users: options.users,
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
  };
}

interface UserResult {
  readonly commandAcknowledgementMs: number;
  readonly queryVisibilityMs: number;
  readonly subscriptionDeliveryMs: number;
}

async function runUser(
  baseUrl: string,
  index: number,
  visibilityTimeoutMs: number,
): Promise<UserResult> {
  const session = new Http2SessionManager(baseUrl);
  const transport = createGrpcTransport({ baseUrl, sessionManager: session });
  const commands = createClient(CommandService, transport);
  const queries = createClient(QueryService, transport);
  const subscriptions = createClient(SubscriptionService, transport);
  const id = `load-${String(index)}-${randomUUID()}`;
  const actorContext = metadata.actorContext({
    actor: create(UserIdSchema, { value: `load-user-${String(index)}` }),
  });
  const controller = new AbortController();
  let iterator: AsyncIterator<SubscriptionUpdate> | undefined;

  try {
    const subscription = await withTimeout(
      subscriptions.subscribe(createTopic(id, actorContext)),
      "subscription creation",
      visibilityTimeoutMs,
    );
    iterator = subscriptions
      .activate(subscription, { signal: controller.signal })
      [Symbol.asyncIterator]();
    const firstUpdate = iterator.next();
    const submittedAt = performance.now();
    const acknowledgement = await withTimeout(
      commands.post(
        create(CommandSchema, {
          id: metadata.commandId(`load-command-${id}`),
          message: packAny(
            CreateProjectSchema,
            create(CreateProjectSchema, { id, name: `Load project ${String(index)}` }),
          ),
          context: metadata.commandContext({ actorContext }),
        }),
      ),
      "command acknowledgement",
      visibilityTimeoutMs,
    );
    const commandAcknowledgementMs = performance.now() - submittedAt;
    if (acknowledgement.status?.status.case !== "ok") {
      throw new Error(
        `CreateProject acknowledgement was ${acknowledgement.status?.status.case ?? "missing"}.`,
      );
    }

    const queryVisibilityMs = await waitForVisibility(
      queries,
      id,
      actorContext,
      submittedAt,
      visibilityTimeoutMs,
    );
    const subscriptionStartedAt = performance.now();
    const update = await withTimeout(
      firstUpdate,
      "project subscription update",
      visibilityTimeoutMs,
    );
    if (update.done) throw new Error("Project subscription ended before its first update.");
    const subscriptionDeliveryMs = performance.now() - subscriptionStartedAt;
    const correlated =
      update.value.update.case === "entityUpdates" &&
      update.value.update.value.update.some(
        (row) =>
          row.kind.case === "state" && unpackAny(row.kind.value, ProjectSummarySchema)?.id === id,
      );
    if (!correlated) throw new Error(`Project subscription update was not correlated to ${id}.`);

    return {
      commandAcknowledgementMs,
      queryVisibilityMs,
      subscriptionDeliveryMs,
    };
  } finally {
    controller.abort();
    session.abort();
    try {
      await withTimeout(Promise.resolve(iterator?.return?.()), "subscription cleanup", 500);
    } catch {
      // Subscription cleanup is intentionally best effort.
    }
  }
}

async function waitForVisibility(
  queries: ReturnType<typeof createClient<typeof QueryService>>,
  id: string,
  actorContext: ReturnType<typeof metadata.actorContext>,
  startedAt: number,
  timeoutMs: number,
): Promise<number> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const response = await withTimeout(
      queries.read(createQuery(id, actorContext)),
      "query visibility read",
      timeoutMs,
    );
    const visible = response.message.some((row) => {
      if (row.state === undefined) return false;
      return unpackAny(row.state, ProjectSummarySchema)?.id === id;
    });
    if (response.response?.status?.status.case === "ok" && visible)
      return performance.now() - startedAt;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`ProjectSummary ${id} was not visible within ${String(timeoutMs)}ms.`);
}

function createQuery(id: string, actorContext: ReturnType<typeof metadata.actorContext>) {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: `load-query-${id}-${randomUUID()}` }),
    target: target(id),
    context: actorContext,
  });
}

function createTopic(id: string, actorContext: ReturnType<typeof metadata.actorContext>) {
  return create(TopicSchema, {
    id: create(TopicIdSchema, { value: `load-topic-${id}` }),
    target: target(id),
    context: actorContext,
  });
}

function target(id: string) {
  return create(TargetSchema, {
    type: deriveTypeUrl(ProjectSummarySchema),
    criterion: {
      case: "filters",
      value: create(TargetFiltersSchema, {
        idFilter: { id: [packAny(StringValueSchema, create(StringValueSchema, { value: id }))] },
      }),
    },
  });
}

function percentiles(values: readonly number[]): LatencyPercentiles {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
  };
}

function percentile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${label} timed out after ${String(timeoutMs)}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
