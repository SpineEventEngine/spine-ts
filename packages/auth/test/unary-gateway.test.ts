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

import { clone, create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { AnySchema, TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import {
  ActorContextSchema,
  CommandContextSchema,
  CommandSchema,
  TenantIdSchema,
  UserIdSchema,
  ZoneIdSchema,
} from "@spine-event-engine/proto";
import {
  ResolveContextRequestSchema,
  ResolveContextResponseSchema,
} from "@spine-event-engine/proto/auth";
import { QuerySchema } from "@spine-event-engine/proto/client";
import { TypeRegistry, type TypeRegistryLookup, AnyMessages } from "@spine-event-engine/core";
import { describe, expect, it } from "vitest";

import {
  type IncomingRequest,
  type UnaryGatewayRequest,
  type UnaryGatewayOptions,
  UnaryGateway,
  TransportFacts,
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
    readonly forward?: (request: { readonly signal?: AbortSignal }) => Promise<Uint8Array>;
    readonly registry?: TypeRegistryLookup;
  } = {},
) {
  const calls: string[] = [];
  const forwarded: { service: string; method: string; value: Uint8Array }[] = [];
  const options: UnaryGatewayOptions = {
    ...(overrides.registry === undefined ? {} : { registry: overrides.registry }),
    maxRequestBytes: overrides.maxRequestBytes ?? 1024,
    sessions: {
      resolve: () => {
        calls.push("session");
        return Promise.resolve(
          overrides.session === "missing"
            ? undefined
            : { principal: { id: "principal" }, expiresAt: sessionExpiry },
        );
      },
    },
    authorize: async (_principal, incoming) => {
      calls.push("authorize");
      return (await overrides.authorize?.(incoming)) ?? overrides.authorized ?? true;
    },
    contexts: {
      resolve: (_principal, incoming) => {
        calls.push("resolve-request");
        overrides.resolve?.(incoming);
        return Promise.resolve({
          actor: create(UserIdSchema, { value: overrides.trustedActor ?? "actor-1" }),
          tenant: tenant(overrides.trustedTenant ?? "tenant-1"),
          timestamp: create(TimestampSchema, { seconds: 2n }),
          zoneId: create(ZoneIdSchema, { value: "Europe/Lisbon" }),
          language: 1,
        });
      },
      resolveContext: () => {
        calls.push("resolve-context");
        return Promise.resolve({
          actor: create(UserIdSchema, { value: "actor-1" }),
          tenant: tenant("tenant-1"),
          timestamp: create(TimestampSchema, { seconds: 2n }),
        });
      },
    },
    clock: { now: overrides.clock ?? (() => clockTimestamp) },
    forward: (request) => {
      calls.push("forward");
      forwarded.push(request);
      if (overrides.forwardReject !== undefined) throw overrides.forwardReject;
      if (overrides.forward !== undefined) return overrides.forward(request);
      return Promise.resolve(new Uint8Array([1]));
    },
  };
  const gateway = new UnaryGateway(options);
  return { calls, forwarded, gateway, options };
}

function request(service: string, method: string, value: Uint8Array): UnaryGatewayRequest {
  return {
    service,
    method,
    value,
    credential: { kind: "bearer" as const, value: "credential-never-forwarded" },
    transport: TransportFacts.from({ service, method }),
  };
}

describe("UnaryGateway", () => {
  it.each([
    ["neither", { sessions: undefined }],
    ["both", { publicAccess: true }],
  ] as const)("rejects %s authenticated/public admission configuration", (_name, override) => {
    const fixture = setup();

    expect(
      () => new UnaryGateway({ ...fixture.options, ...override } as UnaryGatewayOptions),
    ).toThrow("exactly one of sessions or publicAccess");
  });

  it("rejects an authenticated request when no credential was supplied", async () => {
    const fixture = setup();
    const incoming = request(
      "spine.auth.AuthenticationService",
      "ResolveContext",
      toBinary(ResolveContextRequestSchema, create(ResolveContextRequestSchema)),
    );

    await expect(fixture.gateway.handle({ ...incoming, credential: undefined })).resolves.toEqual({
      kind: "rejected",
      reason: "unauthenticated",
    });
    expect(fixture.calls).toEqual([]);
  });

  it("resolves public context without a session expiry", async () => {
    const fixture = setup();
    const gateway = new UnaryGateway({
      ...fixture.options,
      sessions: undefined,
      publicAccess: true,
    } as unknown as UnaryGatewayOptions);

    const result = await gateway.handle({
      ...request(
        "spine.auth.AuthenticationService",
        "ResolveContext",
        toBinary(ResolveContextRequestSchema, create(ResolveContextRequestSchema)),
      ),
      credential: undefined,
    });

    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") return;
    expect(fromBinary(ResolveContextResponseSchema, result.value).expiresAt).toBeUndefined();
  });

  it("retains its construction-time registry while session resolution is pending", async () => {
    const registered = new TypeRegistry([TenantIdSchema]);
    const replacement = new TypeRegistry();
    let releaseSession: (() => void) | undefined;
    const seen: unknown[] = [];
    const options = {
      registry: registered,
      maxRequestBytes: 1024,
      sessions: {
        resolve: () =>
          new Promise<{ principal: { id: string }; expiresAt: Timestamp }>((resolve) => {
            releaseSession = () => {
              resolve({ principal: { id: "principal" }, expiresAt: sessionExpiry });
            };
          }),
      },
      authorize: (_principal: unknown, incoming: IncomingRequest) => {
        seen.push(incoming.kind === "command" ? incoming.message : undefined);
        return Promise.resolve(true);
      },
      contexts: {
        resolve: (_principal: unknown, incoming: IncomingRequest) => {
          seen.push(incoming.kind === "command" ? incoming.message : undefined);
          return Promise.resolve({
            actor: create(UserIdSchema, { value: "actor-1" }),
            tenant: tenant("tenant-1"),
            timestamp: create(TimestampSchema, { seconds: 2n }),
          });
        },
        resolveContext: () =>
          Promise.resolve({
            actor: create(UserIdSchema, { value: "actor-1" }),
            timestamp: create(TimestampSchema),
          }),
      },
      clock: { now: () => clockTimestamp },
      forward: () => Promise.resolve(new Uint8Array([1])),
    };
    const gateway = new UnaryGateway(options);
    const command = create(CommandSchema, {
      context: create(CommandContextSchema, { actorContext: requestedContext }),
      message: AnyMessages.pack(TenantIdSchema, tenant("fixed")),
    });
    const pending = gateway.handle(
      request("spine.client.CommandService", "Post", toBinary(CommandSchema, command)),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    options.registry = replacement;
    releaseSession?.();

    await expect(pending).resolves.toMatchObject({ kind: "forwarded" });
    expect(seen).toHaveLength(2);
    expect(
      seen.every(
        (message) =>
          (message as { $typeName?: string } | undefined)?.$typeName === TenantIdSchema.typeName,
      ),
    ).toBe(true);
  });

  it("rejects malformed ResolveContext bytes before session resolution", async () => {
    const { calls, gateway } = setup();
    await expect(
      gateway.handle(
        request("spine.auth.AuthenticationService", "ResolveContext", new Uint8Array([255])),
      ),
    ).resolves.toEqual({ kind: "rejected", reason: "malformed-request" });
    expect(calls).toEqual([]);
  });

  it("decodes registered content independently without changing forwarded bytes", async () => {
    const registry = new TypeRegistry([TenantIdSchema]);
    let policyMessage: unknown;
    let contextMessage: unknown;
    const command = create(CommandSchema, {
      context: create(CommandContextSchema, { actorContext: requestedContext }),
      message: AnyMessages.pack(TenantIdSchema, tenant("application")),
    });
    const original = toBinary(CommandSchema, command);
    const { forwarded, gateway } = setup({
      registry,
      authorize: (incoming) => {
        policyMessage = incoming.kind === "command" ? incoming.message : undefined;
        if (incoming.kind === "command" && incoming.message !== undefined)
          (incoming.message as { kind?: unknown }).kind = undefined;
        return true;
      },
      resolve: (incoming) => {
        contextMessage = incoming.kind === "command" ? incoming.message : undefined;
      },
    });
    await expect(
      gateway.handle(request("spine.client.CommandService", "Post", original)),
    ).resolves.toMatchObject({ kind: "forwarded" });
    expect(policyMessage).toBeDefined();
    expect(contextMessage).toBeDefined();
    expect(contextMessage).not.toBe(policyMessage);
    const [forwardedRequest] = forwarded;
    if (forwardedRequest === undefined) throw new Error("Expected one forwarded request.");
    const forwardedCommand = fromBinary(CommandSchema, forwardedRequest.value);
    expect(forwardedCommand.message).toEqual(command.message);
  });

  it("keeps missing, unknown, and malformed application content undecoded while retaining type URLs", async () => {
    const base = create(CommandSchema, {
      context: create(CommandContextSchema, { actorContext: requestedContext }),
    });
    const registry = new TypeRegistry([TenantIdSchema]);
    const knownTypeUrl = AnyMessages.pack(TenantIdSchema, tenant("known")).typeUrl;
    for (const entry of [
      { value: toBinary(CommandSchema, base), typeUrl: "" },
      {
        value: toBinary(
          CommandSchema,
          create(CommandSchema, {
            ...base,
            message: create(AnySchema, {
              typeUrl: "type.spine.io/unknown",
              value: new Uint8Array([1]),
            }),
          }),
        ),
        typeUrl: "type.spine.io/unknown",
      },
      {
        value: toBinary(
          CommandSchema,
          create(CommandSchema, {
            ...base,
            message: create(AnySchema, { typeUrl: knownTypeUrl, value: new Uint8Array([255]) }),
          }),
        ),
        typeUrl: knownTypeUrl,
      },
    ]) {
      let message: unknown = "not-called";
      let messageType = "not-called";
      const { gateway } = setup({
        registry,
        authorize: (incoming) => {
          if (incoming.kind === "command") {
            message = incoming.message;
            messageType = incoming.messageType;
          }
          return true;
        },
      });
      await expect(
        gateway.handle(request("spine.client.CommandService", "Post", entry.value)),
      ).resolves.toMatchObject({ kind: "forwarded" });
      expect(message).toBeUndefined();
      expect(messageType).toBe(entry.typeUrl);
    }
  });
  it("forwards downstream abort capability and cancels noncooperative unary work", async () => {
    let received: AbortSignal | undefined;
    const { gateway } = setup({
      forward: async (request) => {
        received = request.signal;
        await new Promise<void>(() => undefined);
        return new Uint8Array();
      },
    });
    const controller = new AbortController();
    const command = toBinary(
      CommandSchema,
      create(CommandSchema, {
        context: create(CommandContextSchema, { actorContext: requestedContext }),
      }),
    );
    const pending = gateway.handle({
      ...request("spine.client.CommandService", "Post", command),
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(pending).rejects.toThrow("aborted");
    expect(received).toBe(controller.signal);
  });

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
    const { forwarded } = setup();
    const guarded = new UnaryGateway({
      maxRequestBytes: 1024,
      sessions: {
        resolve: async () => {
          await pendingSession;
          return { principal: { id: "principal" }, expiresAt: sessionExpiry };
        },
      },
      authorize: () => Promise.resolve(true),
      contexts: {
        resolve: () =>
          Promise.resolve({
            actor: create(UserIdSchema, { value: "actor-1" }),
            tenant: tenant("tenant-1"),
            timestamp: create(TimestampSchema, { seconds: 2n }),
          }),
        resolveContext: () =>
          Promise.resolve({
            actor: create(UserIdSchema, { value: "actor-1" }),
            tenant: tenant("tenant-1"),
            timestamp: create(TimestampSchema),
          }),
      },
      clock: { now: () => clockTimestamp },
      forward: (entry) => {
        forwarded.push(entry);
        return Promise.resolve(new Uint8Array());
      },
    });
    const result = guarded.handle(request("spine.client.CommandService", "Post", command));
    command.fill(255);
    if (releaseSession === undefined) throw new Error("session release was not captured");
    releaseSession();
    await expect(result).resolves.toMatchObject({ kind: "forwarded" });
    const [firstForward] = forwarded;
    if (firstForward === undefined) throw new Error("expected a forwarded command");
    expect(
      fromBinary(CommandSchema, firstForward.value).context?.actorContext?.actor,
    ).toMatchObject({
      value: "actor-1",
    });
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
    const [firstForward] = forwarded;
    if (firstForward === undefined) throw new Error("expected a forwarded command");
    const forwardedCommand = fromBinary(CommandSchema, firstForward.value);
    const restoredCommand = clone(CommandSchema, forwardedCommand);
    restoredCommand.context = command.context;
    expect(toBinary(CommandSchema, restoredCommand)).toEqual(toBinary(CommandSchema, command));
    expect(forwardedCommand).toMatchObject({
      id: { uuid: "command-1" },
      context: {
        actorContext: {
          actor: create(UserIdSchema, { value: "actor-1" }),
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
    const [firstForward] = forwarded;
    if (firstForward === undefined) throw new Error("expected a forwarded query");
    const forwardedQuery = fromBinary(QuerySchema, firstForward.value);
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
      ...TransportFacts.from({ service: "spine.client.QueryService", method: "Read" }),
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
        if (incoming.kind === "command" && incoming.requestedContext.actor !== undefined)
          incoming.requestedContext.actor.value = "mutated";
        return true;
      },
      resolve: (incoming) => {
        if (incoming.kind === "command" && incoming.command.id !== undefined)
          incoming.command.id.uuid = "mutated";
      },
      clock: () => {
        const timestamp = timestamps.shift();
        if (timestamp === undefined) throw new Error("expected a clock timestamp");
        return timestamp;
      },
    });

    await expect(
      gateway.handle(request("spine.client.CommandService", "Post", wire)),
    ).resolves.toMatchObject({
      kind: "forwarded",
    });

    const [firstForward] = forwarded;
    if (firstForward === undefined) throw new Error("expected a forwarded command");
    const forwardedCommand = fromBinary(CommandSchema, firstForward.value);
    expect(forwardedCommand.id).toMatchObject({ uuid: "original" });
    expect(forwardedCommand.context).toMatchObject({
      actorContext: { timestamp: { seconds: 2n } },
    });
    expect(Array.from(firstForward.value).slice(-3)).toEqual(Array.from(unknownField));
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
          resolve: () => {
            calls.push("session");
            if (stage === "session") throw failure;
            return Promise.resolve({ principal: { id: "principal" }, expiresAt: sessionExpiry });
          },
        },
        authorize: () => {
          calls.push("authorize");
          if (stage === "authorize") throw failure;
          return Promise.resolve(true);
        },
        contexts: {
          resolve: () => {
            calls.push("resolve-request");
            if (stage === "resolve-request") throw failure;
            return Promise.resolve({
              actor: create(UserIdSchema, { value: "actor-1" }),
              tenant: tenant("tenant-1"),
              timestamp: create(TimestampSchema, { seconds: 2n }),
            });
          },
          resolveContext: () =>
            Promise.resolve({
              actor: create(UserIdSchema, { value: "actor-1" }),
              timestamp: create(TimestampSchema),
            }),
        },
        clock: { now: () => clockTimestamp },
        forward: () => {
          calls.push("forward");
          return Promise.resolve(new Uint8Array());
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

  it("returns informational context after session validation without forwarding", async () => {
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
        resolve: () => {
          calls.push("session");
          return Promise.resolve({ principal: { id: "principal" }, expiresAt: sessionExpiry });
        },
      },
      authorize: () => {
        calls.push("authorize");
        return Promise.resolve(true);
      },
      contexts: {
        resolve: () =>
          Promise.resolve({
            actor: create(UserIdSchema, { value: "actor-1" }),
            timestamp: create(TimestampSchema),
          }),
        resolveContext: () => {
          calls.push("resolve-context");
          throw failure;
        },
      },
      clock: { now: () => clockTimestamp },
      forward: () => {
        calls.push("forward");
        return Promise.resolve(new Uint8Array());
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
