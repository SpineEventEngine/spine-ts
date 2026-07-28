import { clone, create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import {
  ActorContextSchema,
  CommandContextSchema,
  CommandSchema,
  TenantIdSchema,
} from "@spine-event-engine/proto";
import {
  ResolveContextRequestSchema,
  ResolveContextResponseSchema,
} from "@spine-event-engine/proto/auth";
import { QuerySchema } from "@spine-event-engine/proto/client";
import { describe, expect, it } from "vitest";

import {
  type IncomingRequest,
  type UnaryGatewayRequest,
  UnaryGateway,
  transportFacts,
} from "../src/index.js";

const clockTimestamp = create(TimestampSchema, { seconds: 101n });
const sessionExpiry = create(TimestampSchema, { seconds: 200n });
const requestedContext = create(ActorContextSchema, {
  actor: { value: "actor-1" },
  tenantId: tenant("tenant-1"),
  timestamp: create(TimestampSchema, { seconds: 1n }),
  zoneId: { value: "Europe/Lisbon" },
  language: 1,
});

function tenant(value: string) {
  return create(TenantIdSchema, { kind: { case: "value", value } });
}

function setup(
  overrides: {
    readonly session?: "missing";
    readonly authorized?: boolean;
    readonly trustedActor?: string;
    readonly trustedTenant?: string;
    readonly maxRequestBytes?: number;
    readonly authorize?: (request: IncomingRequest) => boolean | Promise<boolean>;
    readonly resolve?: (request: IncomingRequest) => void;
    readonly clock?: () => Timestamp;
    readonly forwardReject?: Error;
  } = {},
) {
  const calls: string[] = [];
  const forwarded: { service: string; method: string; value: Uint8Array }[] = [];
  const gateway = new UnaryGateway({
    maxRequestBytes: overrides.maxRequestBytes ?? 1024,
    sessions: {
      resolve: async () => {
        calls.push("session");
        return overrides.session === "missing"
          ? undefined
          : { principal: { id: "principal" }, expiresAt: sessionExpiry };
      },
    },
    authorize: async (_principal, incoming) => {
      calls.push("authorize");
      return (await overrides.authorize?.(incoming)) ?? overrides.authorized ?? true;
    },
    contexts: {
      resolve: async (_principal, incoming) => {
        calls.push("resolve-request");
        overrides.resolve?.(incoming);
        return {
          actor: { value: overrides.trustedActor ?? "actor-1" },
          tenant: tenant(overrides.trustedTenant ?? "tenant-1"),
          timestamp: create(TimestampSchema, { seconds: 2n }),
          zoneId: { value: "Europe/Lisbon" },
          language: 1,
        };
      },
      resolveContext: async () => {
        calls.push("resolve-context");
        return {
          actor: { value: "actor-1" },
          tenant: tenant("tenant-1"),
          timestamp: create(TimestampSchema, { seconds: 2n }),
        };
      },
    },
    clock: { now: overrides.clock ?? (() => clockTimestamp) },
    forward: async (request) => {
      calls.push("forward");
      forwarded.push(request);
      if (overrides.forwardReject !== undefined) throw overrides.forwardReject;
      return new Uint8Array([1]);
    },
  });
  return { calls, forwarded, gateway };
}

function request(service: string, method: string, value: Uint8Array): UnaryGatewayRequest {
  return {
    service,
    method,
    value,
    credential: { kind: "bearer" as const, value: "credential-never-forwarded" },
    transport: transportFacts({ service, method }),
  };
}

describe("UnaryGateway", () => {
  it("owns a byte snapshot while session resolution is pending", async () => {
    let releaseSession: (() => void) | undefined;
    const pendingSession = new Promise<void>((resolve) => {
      releaseSession = resolve;
    });
    const command = toBinary(
      CommandSchema,
      create(CommandSchema, {
        context: create(CommandContextSchema, { actorContext: requestedContext }),
      }),
    );
    const { forwarded, gateway } = setup({
      session: undefined,
    });
    const guarded = new UnaryGateway({
      maxRequestBytes: 1024,
      sessions: {
        resolve: async () => {
          await pendingSession;
          return { principal: { id: "principal" }, expiresAt: sessionExpiry };
        },
      },
      authorize: async () => true,
      contexts: {
        resolve: async () => ({
          actor: { value: "actor-1" },
          tenant: tenant("tenant-1"),
          timestamp: create(TimestampSchema, { seconds: 2n }),
        }),
        resolveContext: async () => ({
          actor: { value: "actor-1" },
          tenant: tenant("tenant-1"),
          timestamp: create(TimestampSchema),
        }),
      },
      clock: { now: () => clockTimestamp },
      forward: async (entry) => {
        forwarded.push(entry);
        return new Uint8Array();
      },
    });
    const result = guarded.handle(request("spine.client.CommandService", "Post", command));
    command.fill(255);
    releaseSession!();
    await expect(result).resolves.toMatchObject({ kind: "forwarded" });
    expect(
      fromBinary(CommandSchema, forwarded[0]!.value).context?.actorContext?.actor,
    ).toMatchObject({ value: "actor-1" });
  });

  it("requires a finite non-negative byte bound at construction", () => {
    expect(() => setup({ maxRequestBytes: Number.POSITIVE_INFINITY })).toThrow(
      "maxRequestBytes must be a finite non-negative integer",
    );
    expect(() => setup({ maxRequestBytes: -1 })).toThrow(
      "maxRequestBytes must be a finite non-negative integer",
    );
  });

  it("rejects oversized, malformed, and unknown unary requests before authentication", async () => {
    for (const entry of [
      request("spine.client.CommandService", "Post", new Uint8Array(1025)),
      request("spine.client.QueryService", "Read", new Uint8Array([255])),
      request("spine.client.UnknownService", "Nope", new Uint8Array()),
    ]) {
      const { calls, gateway } = setup();
      await expect(gateway.handle(entry)).resolves.toEqual({
        kind: "rejected",
        reason:
          entry.value.byteLength > 1024
            ? "request-too-large"
            : entry.service === "spine.client.QueryService"
              ? "malformed-request"
              : "unknown-operation",
      });
      expect(calls).toEqual([]);
    }
  });

  it("does not resolve context or forward unauthenticated and denied requests", async () => {
    const command = toBinary(
      CommandSchema,
      create(CommandSchema, {
        context: create(CommandContextSchema, { actorContext: requestedContext }),
      }),
    );
    for (const overrides of [{ session: "missing" as const }, { authorized: false }]) {
      const { calls, gateway } = setup(overrides);
      await expect(
        gateway.handle(request("spine.client.CommandService", "Post", command)),
      ).resolves.toMatchObject({
        kind: "rejected",
      });
      expect(calls).toEqual(
        overrides.session === "missing" ? ["session"] : ["session", "authorize"],
      );
    }
  });

  it("rejects stale or fabricated actor and tenant hints without forwarding", async () => {
    const command = toBinary(
      CommandSchema,
      create(CommandSchema, {
        context: create(CommandContextSchema, { actorContext: requestedContext }),
      }),
    );
    for (const overrides of [
      { trustedActor: "another-actor" },
      { trustedTenant: "another-tenant" },
    ]) {
      const { calls, gateway } = setup(overrides);
      await expect(
        gateway.handle(request("spine.client.CommandService", "Post", command)),
      ).resolves.toEqual({
        kind: "rejected",
        reason: "context-stale",
      });
      expect(calls).toEqual(["session", "authorize", "resolve-request"]);
    }
  });

  it("replaces matching command context with a fresh complete trusted context and forwards once", async () => {
    const command = create(CommandSchema, {
      id: { uuid: "command-1" },
      context: create(CommandContextSchema, { actorContext: requestedContext, targetVersion: 7 }),
      systemProperties: { schedulingTime: create(TimestampSchema, { seconds: 3n }) },
    });
    const { calls, forwarded, gateway } = setup();

    await expect(
      gateway.handle(
        request("spine.client.CommandService", "Post", toBinary(CommandSchema, command)),
      ),
    ).resolves.toEqual({
      kind: "forwarded",
      value: new Uint8Array([1]),
    });

    expect(calls).toEqual(["session", "authorize", "resolve-request", "forward"]);
    const forwardedCommand = fromBinary(CommandSchema, forwarded[0]!.value);
    const restoredCommand = clone(CommandSchema, forwardedCommand);
    restoredCommand.context = command.context;
    expect(toBinary(CommandSchema, restoredCommand)).toEqual(toBinary(CommandSchema, command));
    expect(forwardedCommand).toMatchObject({
      id: { uuid: "command-1" },
      context: {
        actorContext: {
          actor: { value: "actor-1" },
          tenantId: { kind: { case: "value", value: "tenant-1" } },
          timestamp: { seconds: 2n },
          zoneId: { value: "Europe/Lisbon" },
          language: 1,
        },
        targetVersion: 7,
      },
      systemProperties: { schedulingTime: { seconds: 3n } },
    });
    expect(forwarded[0]).not.toHaveProperty("credential");
    expect(forwarded).toHaveLength(1);
  });

  it("rewrites Query.Read while preserving every field other than its ActorContext", async () => {
    const query = create(QuerySchema, {
      id: { value: "query-1" },
      target: { type: "type.example.test/Thing", criterion: { case: "includeAll", value: true } },
      context: requestedContext,
      format: { limit: 30 },
    });
    const { calls, forwarded, gateway } = setup();

    await expect(
      gateway.handle(request("spine.client.QueryService", "Read", toBinary(QuerySchema, query))),
    ).resolves.toMatchObject({
      kind: "forwarded",
    });

    expect(calls).toEqual(["session", "authorize", "resolve-request", "forward"]);
    const forwardedQuery = fromBinary(QuerySchema, forwarded[0]!.value);
    expect(toBinary(QuerySchema, { ...forwardedQuery, context: requestedContext })).toEqual(
      toBinary(QuerySchema, query),
    );
    expect(forwardedQuery.context).toMatchObject({ timestamp: { seconds: 2n } });
  });

  it("uses the canonical route and immutable allowlisted transport facts for policy and forwarding", async () => {
    const command = toBinary(
      CommandSchema,
      create(CommandSchema, {
        context: create(CommandContextSchema, { actorContext: requestedContext }),
      }),
    );
    let policyTransport: unknown;
    let resolverTransport: unknown;
    const { forwarded, gateway } = setup({
      authorize: (incoming) => {
        policyTransport = incoming.transport;
        expect(Object.isFrozen(incoming.transport)).toBe(true);
        expect(Reflect.set(incoming.transport, "method", "Read")).toBe(false);
        return true;
      },
      resolve: (incoming) => {
        resolverTransport = incoming.transport;
      },
    });

    const mismatchedTransport = {
      ...transportFacts({ service: "spine.client.QueryService", method: "Read" }),
      credential: "discarded-runtime-extra",
    };
    await gateway.handle({
      ...request("spine.client.CommandService", "Post", command),
      transport: mismatchedTransport,
    });

    expect(policyTransport).toEqual({
      service: "spine.client.CommandService",
      method: "Post",
    });
    expect(resolverTransport).toEqual({
      service: "spine.client.CommandService",
      method: "Post",
    });
    expect(resolverTransport).not.toBe(policyTransport);
    expect(forwarded[0]).toMatchObject({ service: "spine.client.CommandService", method: "Post" });
  });

  it("isolates mutable collaborator views, preserves unknown fields, and uses the resolver timestamp", async () => {
    const command = create(CommandSchema, {
      id: { uuid: "original" },
      context: create(CommandContextSchema, { actorContext: requestedContext }),
    });
    const unknownField = new Uint8Array([0xa0, 0x06, 0x01]);
    const wire = new Uint8Array([...toBinary(CommandSchema, command), ...unknownField]);
    const timestamps = [
      create(TimestampSchema, { seconds: 101n }),
      create(TimestampSchema, { seconds: 102n }),
    ];
    const { forwarded, gateway } = setup({
      authorize: (incoming) => {
        if (incoming.kind === "command") incoming.requestedContext.actor!.value = "mutated";
        return true;
      },
      resolve: (incoming) => {
        if (incoming.kind === "command") incoming.command.id!.uuid = "mutated";
      },
      clock: () => timestamps.shift()!,
    });

    await expect(
      gateway.handle(request("spine.client.CommandService", "Post", wire)),
    ).resolves.toMatchObject({
      kind: "forwarded",
    });

    const forwardedCommand = fromBinary(CommandSchema, forwarded[0]!.value);
    expect(forwardedCommand.id).toMatchObject({ uuid: "original" });
    expect(forwardedCommand.context).toMatchObject({
      actorContext: { timestamp: { seconds: 2n } },
    });
    expect(Array.from(forwarded[0]!.value).slice(-3)).toEqual(Array.from(unknownField));
  });

  it("does not retry forwarding or begin later work after a collaborator rejects", async () => {
    const command = toBinary(
      CommandSchema,
      create(CommandSchema, {
        context: create(CommandContextSchema, { actorContext: requestedContext }),
      }),
    );
    const forwardFailure = new Error("backend unavailable");
    const { calls, gateway } = setup({ forwardReject: forwardFailure });

    await expect(
      gateway.handle(request("spine.client.CommandService", "Post", command)),
    ).rejects.toBe(forwardFailure);
    expect(calls).toEqual(["session", "authorize", "resolve-request", "forward"]);
  });

  it("propagates collaborator failures without starting later work or retrying", async () => {
    const command = toBinary(
      CommandSchema,
      create(CommandSchema, {
        context: create(CommandContextSchema, { actorContext: requestedContext }),
      }),
    );
    for (const stage of ["session", "authorize", "resolve-request"] as const) {
      const failure = new Error(`${stage} failed`);
      const calls: string[] = [];
      const gateway = new UnaryGateway({
        maxRequestBytes: 1024,
        sessions: {
          resolve: async () => {
            calls.push("session");
            if (stage === "session") throw failure;
            return { principal: { id: "principal" }, expiresAt: sessionExpiry };
          },
        },
        authorize: async () => {
          calls.push("authorize");
          if (stage === "authorize") throw failure;
          return true;
        },
        contexts: {
          resolve: async () => {
            calls.push("resolve-request");
            if (stage === "resolve-request") throw failure;
            return {
              actor: { value: "actor-1" },
              tenant: tenant("tenant-1"),
              timestamp: create(TimestampSchema, { seconds: 2n }),
            };
          },
          resolveContext: async () => ({
            actor: { value: "actor-1" },
            timestamp: create(TimestampSchema),
          }),
        },
        clock: { now: () => clockTimestamp },
        forward: async () => {
          calls.push("forward");
          return new Uint8Array();
        },
      });
      await expect(
        gateway.handle(request("spine.client.CommandService", "Post", command)),
      ).rejects.toBe(failure);
      expect(calls).toEqual(
        stage === "session"
          ? ["session"]
          : stage === "authorize"
            ? ["session", "authorize"]
            : ["session", "authorize", "resolve-request"],
      );
    }
  });

  it("returns informational ResolveContext data after session validation without policy, resolver, or forwarding", async () => {
    const { calls, gateway } = setup();
    const result = await gateway.handle(
      request(
        "spine.auth.AuthenticationService",
        "ResolveContext",
        toBinary(ResolveContextRequestSchema, create(ResolveContextRequestSchema)),
      ),
    );

    expect(result).toMatchObject({ kind: "resolved" });
    expect(
      result.kind === "resolved" && fromBinary(ResolveContextResponseSchema, result.value),
    ).toMatchObject({
      actor: { value: "actor-1" },
      tenant: { kind: { case: "value", value: "tenant-1" } },
      expiresAt: { seconds: 200n },
    });
    expect(calls).toEqual(["session", "resolve-context"]);
  });

  it("stops ResolveContext when its resolver rejects", async () => {
    const failure = new Error("resolve context failed");
    const calls: string[] = [];
    const gateway = new UnaryGateway({
      maxRequestBytes: 1024,
      sessions: {
        resolve: async () => {
          calls.push("session");
          return { principal: { id: "principal" }, expiresAt: sessionExpiry };
        },
      },
      authorize: async () => {
        calls.push("authorize");
        return true;
      },
      contexts: {
        resolve: async () => ({ actor: { value: "actor-1" }, timestamp: create(TimestampSchema) }),
        resolveContext: async () => {
          calls.push("resolve-context");
          throw failure;
        },
      },
      clock: { now: () => clockTimestamp },
      forward: async () => {
        calls.push("forward");
        return new Uint8Array();
      },
    });
    await expect(
      gateway.handle(
        request("spine.auth.AuthenticationService", "ResolveContext", new Uint8Array()),
      ),
    ).rejects.toBe(failure);
    expect(calls).toEqual(["session", "resolve-context"]);
  });
});
