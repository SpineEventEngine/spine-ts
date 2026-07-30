import { randomUUID } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { TypeUrls, AnyMessages } from "@spine-event-engine/core";
import { CommandSchema, UserIdSchema } from "@spine-event-engine/proto";
import { CommandService } from "@spine-event-engine/proto/client";
import { TargetFiltersSchema, TargetSchema } from "@spine-event-engine/proto/client";
import { QueryIdSchema, QuerySchema } from "@spine-event-engine/proto/client";
import { QueryService } from "@spine-event-engine/proto/client";
import {
  TopicIdSchema,
  TopicSchema,
  type SubscriptionUpdate,
} from "@spine-event-engine/proto/client";
import { SubscriptionService } from "@spine-event-engine/proto/client";
import { SignalMetadata } from "@spine-event-engine/server";

import { CreateProjectSchema } from "../generated/spine/example/project_management/v1/commands_pb.js";
import { ProjectSummarySchema } from "../generated/spine/example/project_management/v1/read_models_pb.js";
import { LatencyDistribution, type LatencyPercentiles } from "./internal/latency-distribution.js";

export type { LatencyPercentiles } from "./internal/latency-distribution.js";

/** Supported independent-user levels for repeatable local load scenarios. */
export const projectManagementLoadLevels = [10, 25, 50, 100] as const;

/** Defines one supported independent-user level for the load scenario. */
export type ProjectManagementLoadLevel = (typeof projectManagementLoadLevels)[number];

/** Configures a project-management load run. */
export interface ProjectManagementLoadOptions {
  /** Supplies the gRPC server URL used by every independent user. */
  readonly baseUrl: string;
  /** Selects the fixed number of independent users to run. */
  readonly users: ProjectManagementLoadLevel;
  /** Bounds a command, query, or subscription visibility wait in milliseconds. */
  readonly visibilityTimeoutMs?: number;
}

/** Summarizes successful and failed independent load users. */
export interface ProjectManagementLoadResult {
  /** Reports the requested number of independent users. */
  readonly users: number;
  /** Reports users whose command, query, or subscription path failed. */
  readonly failedUsers: number;
  /** Counts users receiving an OK command acknowledgement. */
  readonly commandAcknowledgements: number;
  /** Counts users observing their exact project through a query. */
  readonly queryVisibilities: number;
  /** Counts users receiving a correlated subscription update. */
  readonly subscriptionDeliveries: number;
  /** Reports command acknowledgement latency percentiles. */
  readonly commandAcknowledgementLatency: LatencyPercentiles;
  /** Reports query visibility latency percentiles. */
  readonly queryVisibilityLatency: LatencyPercentiles;
  /** Reports correlated subscription delivery latency percentiles. */
  readonly subscriptionDeliveryLatency: LatencyPercentiles;
  /** Reports successful users per elapsed second, or zero for zero elapsed time. */
  readonly throughputPerSecond: number;
}

const metadata = new SignalMetadata();

/**
 * Executes independent asynchronous users against the real generated gRPC services.
 *
 * @param options Configures the server, user level, and bounded visibility waits.
 * @returns Summarizes acknowledged commands, visible queries, deliveries, failures, and latency.
 */
export async function runProjectManagementLoad(
  options: ProjectManagementLoadOptions,
): Promise<ProjectManagementLoadResult> {
  const visibilityTimeoutMs = options.visibilityTimeoutMs ?? 5_000;
  const startedAt = performance.now();
  const settled = await Promise.allSettled(
    Array.from({ length: options.users }, (_, index) =>
      new ProjectManagementUserLoad(options.baseUrl, index, visibilityTimeoutMs).execute(),
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
    commandAcknowledgementLatency: LatencyDistribution.from(
      results.map((result) => result.commandAcknowledgementMs),
    ),
    queryVisibilityLatency: LatencyDistribution.from(
      results.map((result) => result.queryVisibilityMs),
    ),
    subscriptionDeliveryLatency: LatencyDistribution.from(
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

interface SubscriptionRead {
  readonly iterator: AsyncIterator<SubscriptionUpdate>;
  readonly firstUpdate: Promise<IteratorResult<SubscriptionUpdate>>;
}

class ProjectManagementUserLoad {
  private readonly session: Http2SessionManager;
  private readonly commands: ReturnType<typeof createClient<typeof CommandService>>;
  private readonly queries: ReturnType<typeof createClient<typeof QueryService>>;
  private readonly subscriptions: ReturnType<typeof createClient<typeof SubscriptionService>>;
  private readonly id: string;
  private readonly actorContext: ReturnType<typeof metadata.actorContext>;
  private readonly controller = new AbortController();

  constructor(
    baseUrl: string,
    private readonly index: number,
    private readonly visibilityTimeoutMs: number,
  ) {
    this.session = new Http2SessionManager(baseUrl);
    const transport = createGrpcTransport({ baseUrl, sessionManager: this.session });
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
      return {
        commandAcknowledgementMs,
        queryVisibilityMs,
        subscriptionDeliveryMs,
      };
    } finally {
      await this.cleanup(read?.iterator);
    }
  }

  private async startSubscription(): Promise<SubscriptionRead> {
    const subscription = await this.withTimeout(
      this.subscriptions.subscribe(this.createTopic()),
      "subscription creation",
      this.visibilityTimeoutMs,
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
      this.commands.post(this.createCommand()),
      "command acknowledgement",
      this.visibilityTimeoutMs,
    );
    if (acknowledgement.status?.status.case !== "ok") {
      throw new Error(
        `CreateProject acknowledgement was ${acknowledgement.status?.status.case ?? "missing"}.`,
      );
    }
    return performance.now() - submittedAt;
  }

  private createCommand() {
    return create(CommandSchema, {
      id: metadata.commandId(`load-command-${this.id}`),
      message: AnyMessages.pack(
        CreateProjectSchema,
        create(CreateProjectSchema, { id: this.id, name: `Load project ${String(this.index)}` }),
      ),
      context: metadata.commandContext({ actorContext: this.actorContext }),
    });
  }

  private async readSubscription(
    firstUpdate: Promise<IteratorResult<SubscriptionUpdate>>,
  ): Promise<number> {
    const startedAt = performance.now();
    const update = await this.withTimeout(
      firstUpdate,
      "project subscription update",
      this.visibilityTimeoutMs,
    );
    if (update.done) throw new Error("Project subscription ended before its first update.");
    if (!this.isCorrelated(update.value))
      throw new Error(`Project subscription update was not correlated to ${this.id}.`);
    return performance.now() - startedAt;
  }

  private isCorrelated(update: SubscriptionUpdate): boolean {
    return (
      update.update.case === "entityUpdates" &&
      update.update.value.update.some(
        (row) =>
          row.kind.case === "state" &&
          AnyMessages.unpack(row.kind.value, ProjectSummarySchema)?.id === this.id,
      )
    );
  }

  private async cleanup(iterator?: AsyncIterator<SubscriptionUpdate>): Promise<void> {
    this.controller.abort();
    this.session.abort();
    try {
      await this.withTimeout(Promise.resolve(iterator?.return?.()), "subscription cleanup", 500);
    } catch {
      // Subscription cleanup is intentionally best effort.
    }
  }

  private async waitForVisibility(startedAt: number): Promise<number> {
    const deadline = performance.now() + this.visibilityTimeoutMs;
    while (performance.now() < deadline) {
      const response = await this.withTimeout(
        this.queries.read(this.createQuery()),
        "query visibility read",
        this.visibilityTimeoutMs,
      );
      const visible = response.message.some((row) => {
        if (row.state === undefined) return false;
        return AnyMessages.unpack(row.state, ProjectSummarySchema)?.id === this.id;
      });
      if (response.response?.status?.status.case === "ok" && visible)
        return performance.now() - startedAt;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(
      `ProjectSummary ${this.id} was not visible within ${String(this.visibilityTimeoutMs)}ms.`,
    );
  }

  private createQuery() {
    return create(QuerySchema, {
      id: create(QueryIdSchema, { value: `load-query-${this.id}-${randomUUID()}` }),
      target: this.createTarget(),
      context: this.actorContext,
    });
  }

  private createTopic() {
    return create(TopicSchema, {
      id: create(TopicIdSchema, { value: `load-topic-${this.id}` }),
      target: this.createTarget(),
      context: this.actorContext,
    });
  }

  private createTarget() {
    return create(TargetSchema, {
      type: TypeUrls.derive(ProjectSummarySchema),
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

  private async withTimeout<T>(promise: Promise<T>, label: string, timeoutMs: number): Promise<T> {
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
}
