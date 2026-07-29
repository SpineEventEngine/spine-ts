import * as http2 from "node:http2";
import * as tls from "node:tls";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  create,
  fromBinary,
} from "../../../../packages/proto/node_modules/@bufbuild/protobuf/dist/esm/index.js";
import { TimestampSchema } from "../../../../packages/proto/node_modules/@bufbuild/protobuf/dist/esm/wkt/gen/google/protobuf/timestamp_pb.js";
import {
  connectNodeAdapter,
  createGrpcTransport,
} from "../../../../packages/server/node_modules/@connectrpc/connect-node/dist/esm/index.js";
import { AuthenticationService } from "../../../../packages/proto/dist/src/auth/index.js";
import { CommandSchema } from "../../../../packages/proto/dist/src/index.js";
import {
  QuerySchema,
  TopicSchema,
  CommandService,
  QueryService,
  SubscriptionService,
} from "../../../../packages/proto/dist/src/client/index.js";
import {
  createNativeGatewayServices,
  InMemorySubscriptionBindings,
  NativeSubscriptionCreator,
  OpaqueSessionCookies,
  OpaqueSessions,
  SubscriptionGateway,
  transportFacts,
  UnaryGateway,
} from "../../../../packages/auth/dist/index.js";
import {
  ChatAuthorizationPolicy,
  ChatContextResolver,
  startChatServer,
  typeRegistry,
} from "../../../../examples/chat/dist/src/index.js";
import { renderEnvoy } from "../../../../interop/envoy/render.mjs";

const run = promisify(execFile);
const image =
  "envoyproxy/envoy:v1.38.3@sha256:5f7c43e1147412fdb3af578c651c67478a3df818eae89d2261e707e06c209cdb";

/** Starts only test-owned processes and always closes them in reverse dependency order. */
export async function startTopology({ lifecycle = {} } = {}) {
  const runCommand = lifecycle.run ?? run;
  const startBackend = lifecycle.startBackend ?? startChatServer;
  const createGateway = lifecycle.createGateway;
  const listenGateway = lifecycle.listen ?? listen;
  const closeGateway = lifecycle.closeGateway ?? close;
  const createDirectory = lifecycle.mkdtemp ?? mkdtemp;
  const write = lifecycle.writeFile ?? writeFile;
  const remove = lifecycle.rm ?? rm;
  const awaitReady = lifecycle.ready ?? ready;
  const cleanup = createCleanupOwner({ onAttempt: lifecycle.onCleanupAttempt });
  let container;
  try {
    const browserOrigin = "https://127.0.0.1:4175";
    const backend = await startBackend();
    cleanup.add("chat backend", 10, () => backend.close());
    const transport = createGrpcTransport({ baseUrl: backend.baseUrl });
    const creator = new NativeSubscriptionCreator(transport);
    const counters = {
      forward: 0,
      subscribe: 0,
      activate: 0,
      activeStreams: 0,
      updates: 0,
      cancel: 0,
      dispose: 0,
    };
    const forwardedContexts = [];
    const observedCreator = {
      async subscribe(request, signal) {
        counters.subscribe += 1;
        forwardedContexts.push(contextSummary(fromBinary(TopicSchema, request.bytes).context));
        return creator.subscribe(request, signal);
      },
      async activate(request, signal) {
        counters.activate += 1;
        counters.activeStreams += 1;
        try {
          return await creator.activate(
            {
              ...request,
              updates: async (update) => {
                counters.updates += 1;
                await request.updates(update);
              },
            },
            signal,
          );
        } finally {
          counters.activeStreams -= 1;
        }
      },
      async cancel(request, signal) {
        counters.cancel += 1;
        return creator.cancel(request, signal);
      },
      async dispose(envelope, signal) {
        counters.dispose += 1;
        return creator.dispose(envelope, signal);
      },
    };
    const policy = new ChatAuthorizationPolicy();
    const contexts = new ChatContextResolver();
    const clock = {
      now: () => create(TimestampSchema, { seconds: BigInt(Math.floor(Date.now() / 1000)) }),
    };
    const cookieSessions = new OpaqueSessions();
    cleanup.add("cookie sessions", 30, () => cookieSessions.close());
    let expiredNow = 0;
    const expiredSessions = new OpaqueSessions({
      clock: { now: () => expiredNow },
      ttlMilliseconds: 1,
    });
    cleanup.add("expired cookie sessions", 20, () => expiredSessions.close());
    const cookieCredentials = new OpaqueSessionCookies({
      csrfSecret: new Uint8Array(32).fill(7),
      origins: [browserOrigin],
    });
    cleanup.add("cookie credential helper", 40, () => cookieCredentials.close());
    const principal = { id: "ada", attributes: { rooms: "room-a" } };
    const principalB = { id: "bert", attributes: { rooms: "room-a" } };
    const created = await cookieSessions.create(principal);
    if (created.kind !== "created")
      throw new Error(`cookie session creation failed: ${created.reason}`);
    const createdB = await cookieSessions.create(principalB);
    if (createdB.kind !== "created")
      throw new Error(`secondary cookie session creation failed: ${createdB.reason}`);
    const expired = await expiredSessions.create(principal);
    if (expired.kind !== "created")
      throw new Error(`expired cookie session creation failed: ${expired.reason}`);
    expiredNow = 2;
    const bearerSession = {
      principal,
      expiresAt: create(TimestampSchema, { seconds: BigInt(Math.floor(Date.now() / 1000) + 60) }),
    };
    const sessions = {
      resolve: async (credential) => {
        if (credential.kind === "bearer" && credential.value === "test") return bearerSession;
        return (await cookieSessions.resolve(credential)) ?? expiredSessions.resolve(credential);
      },
    };
    const unary = new UnaryGateway({
      registry: typeRegistry,
      maxRequestBytes: 1_048_576,
      sessions,
      authorize: policy.authorize.bind(policy),
      contexts,
      clock,
      forward: async (request) => {
        counters.forward += 1;
        const context =
          request.method === "Post"
            ? fromBinary(CommandSchema, request.value).context?.actorContext
            : fromBinary(QuerySchema, request.value).context;
        forwardedContexts.push(contextSummary(context));
        return creator.forward(request);
      },
    });
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => globalThis.crypto.randomUUID(),
      dispose: creator.dispose.bind(creator),
    });
    cleanup.add("subscription bindings", 80, () => bindings.close());
    const subscriptions = new SubscriptionGateway({
      bindings,
      sessions,
      authorize: policy.authorize.bind(policy),
      contexts,
      clock,
      fingerprint: (principal) => principal.id,
      creator: observedCreator,
    });
    const services = createNativeGatewayServices({
      unary,
      subscriptions,
      requests: {
        credential: (context) => {
          const extracted = cookieCredentials.extract(
            Object.fromEntries(context.requestHeader.entries()),
          );
          return extracted.kind === "rejected" ? { kind: "bearer", value: "" } : extracted;
        },
        transport: (context) =>
          transportFacts({
            service: "browser",
            method: "gateway",
            origin: context.requestHeader.get("origin") ?? undefined,
            headers: Object.fromEntries(context.requestHeader.entries()),
          }),
      },
    });
    const gateway =
      createGateway?.(services) ??
      http2.createServer(
        connectNodeAdapter({
          routes(router) {
            router.service(AuthenticationService, services.authentication);
            router.service(CommandService, services.command);
            router.service(QueryService, services.query);
            router.service(SubscriptionService, services.subscription);
          },
        }),
      );
    cleanup.add("gateway", 70, () => closeGateway(gateway));
    await listenGateway(gateway, 9443);
    const directory = await createDirectory(join(tmpdir(), "spine-e1-"));
    cleanup.add("temporary TLS directory", 0, () =>
      remove(directory, { recursive: true, force: true }),
    );
    await runCommand("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      join(directory, "key.pem"),
      "-out",
      join(directory, "cert.pem"),
      "-days",
      "1",
      "-nodes",
      "-subj",
      "/CN=127.0.0.1",
    ]);
    await write(
      join(directory, "envoy.yaml"),
      renderEnvoy({
        browserOrigin,
        gatewayAddress: "host.docker.internal",
        tlsCertificate: "/run/tls/cert.pem",
        tlsKey: "/run/tls/key.pem",
      }),
    );
    const { stdout } = await runCommand("docker", [
      "run",
      "-d",
      "--rm",
      "-p",
      "8443:8443",
      "-v",
      `${join(directory, "envoy.yaml")}:/etc/envoy/envoy.yaml:ro`,
      "-v",
      `${directory}:/run/tls:ro`,
      image,
      "-c",
      "/etc/envoy/envoy.yaml",
    ]);
    container = stdout.trim();
    cleanup.add("Envoy container", 100, () => runCommand("docker", ["rm", "-f", container]));
    await awaitReady(container);
    return {
      baseUrl: "https://127.0.0.1:8443",
      cookie: Object.freeze({
        setCookie: cookieCredentials.issue(created.credential.value),
        csrf: cookieCredentials.csrf(created.credential.value),
      }),
      cookieB: Object.freeze({
        setCookie: cookieCredentials.issue(createdB.credential.value),
        csrf: cookieCredentials.csrf(createdB.credential.value),
      }),
      expiredCookie: Object.freeze({
        setCookie: cookieCredentials.issue(expired.credential.value),
        csrf: cookieCredentials.csrf(expired.credential.value),
      }),
      tls: Object.freeze({ key: join(directory, "key.pem"), cert: join(directory, "cert.pem") }),
      bindingCount: () => bindings.size,
      counters: () => Object.freeze({ ...counters }),
      forwardedContexts: () => Object.freeze(forwardedContexts.map((context) => ({ ...context }))),
      async close() {
        await cleanup.close();
      },
    };
  } catch (error) {
    const logs =
      container === undefined
        ? ""
        : await runCommand("docker", ["logs", container])
            .then((result) => result.stderr)
            .catch(() => "");
    try {
      await cleanup.close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `${error instanceof Error ? error.message : String(error)}\n${logs}`,
      );
    }
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${logs}`);
  }
}

function createCleanupOwner({ timeoutMilliseconds = 5_000, onAttempt } = {}) {
  const cleanup = [];
  let closed = false;
  return {
    add(label, order, dispose) {
      if (closed) throw new Error(`Cannot acquire ${label} after topology cleanup begins.`);
      cleanup.push({ label, order, dispose, index: cleanup.length });
    },
    async close() {
      if (closed) return;
      closed = true;
      const failures = [];
      const ordered = [...cleanup].sort(
        (left, right) => right.order - left.order || right.index - left.index,
      );
      for (const resource of ordered) {
        try {
          onAttempt?.(resource.label);
          await within(resource.dispose(), timeoutMilliseconds, resource.label);
        } catch (error) {
          failures.push(
            new Error(
              `${resource.label}: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          "Topology cleanup failed after all owned resources were attempted.",
        );
      }
    },
  };
}

function within(operation, timeoutMilliseconds, label) {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(
      () => reject(new Error(`${label} cleanup exceeded ${timeoutMilliseconds}ms.`)),
      timeoutMilliseconds,
    );
    Promise.resolve(operation).then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function contextSummary(context) {
  return Object.freeze({
    actor: context?.actor?.value,
    tenant: context?.tenantId === undefined ? false : true,
    timestamp: context?.timestamp === undefined ? false : true,
    zone: context?.zoneId === undefined ? false : true,
    language: context?.language !== 0,
  });
}
function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}
function close(server) {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
async function ready(container) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { stdout } = await run("docker", ["inspect", "-f", "{{.State.Running}}", container]);
    if (stdout.trim() !== "true") {
      const { stderr } = await run("docker", ["logs", container]);
      throw new Error(`Envoy exited before readiness: ${stderr}`);
    }
    try {
      await new Promise((resolve, reject) => {
        const socket = tls.connect({ host: "127.0.0.1", port: 8443, rejectUnauthorized: false });
        socket.once("secureConnect", () => {
          socket.destroy();
          resolve();
        });
        socket.once("error", (error) => {
          socket.destroy();
          reject(error);
        });
      });
      return;
    } catch {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
    }
  }
  throw new Error("Envoy did not open port 8443");
}
