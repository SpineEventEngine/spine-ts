// Assembles the private native and public browser test topology used by interop tests.
import * as http2 from "node:http2";
import * as tls from "node:tls";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { fromBinary } from "../../../../../packages/proto/node_modules/@bufbuild/protobuf/dist/esm/index.js";
import {
  connectNodeAdapter,
  createGrpcTransport,
} from "../../../../../packages/server/node_modules/@connectrpc/connect-node/dist/esm/index.js";
import { Server } from "../../../../../packages/server/dist/index.js";
import { CommandSchema } from "../../../../../packages/proto/dist/src/index.js";
import {
  QuerySchema,
  TopicSchema,
  CommandService,
  QueryService,
  SubscriptionService,
} from "../../../../../packages/proto/dist/src/client/index.js";
import {
  createNativeGatewayServices,
  DynamicSubscriptionCreator,
  DynamicUnaryForwarder,
  InMemorySubscriptionBindings,
  NativeSubscriptionCreator,
  SubscriptionGateway,
  TransportFacts,
  UnaryGateway,
} from "../../../../../packages/auth/dist/index.js";
import { ApplicationNode } from "../../../../../packages/deployment/dist/index.js";
import {
  BoardAccessPolicy,
  BoardContextResolver,
  MessageBoardApplication,
  typeRegistry,
} from "../../../../../examples/message-board/app/dist/src/index.js";
import { SystemClock } from "../../../../../examples/message-board/app/dist/src/system-clock.js";
import { renderEnvoy } from "../../../../../interop/envoy/render.mjs";

const run = promisify(execFile);
const image =
  "envoyproxy/envoy:v1.38.3@sha256:5f7c43e1147412fdb3af578c651c67478a3df818eae89d2261e707e06c209cdb";

/**
 * Starts only test-owned processes and always closes them in reverse dependency order.
 */
export async function startTopology({ lifecycle = {} } = {}) {
  const runCommand = lifecycle.run ?? run;
  const application = new MessageBoardApplication();
  const startBackend =
    lifecycle.startBackend ??
    (async () =>
      Server.atPort(0, { host: "127.0.0.1" })
        .add(await application.createContext())
        .start());
  const createGateway = lifecycle.createGateway;
  const createSubscriptions =
    lifecycle.createSubscriptions ?? ((options) => new SubscriptionGateway(options));
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
    cleanup.add("message board backend", 10, () => backend.close());
    const transport = createGrpcTransport({ baseUrl: backend.baseUrl });
    const nativeCreator = new NativeSubscriptionCreator(transport);
    const counters = {
      forward: 0,
      subscribe: 0,
      activate: 0,
      activeStreams: 0,
      updates: 0,
      cancel: 0,
      dispose: 0,
    };
    const trace = [];
    const observe = (kind, details = {}) => trace.push(Object.freeze({ kind, ...details }));
    const observedNativeCreator = {
      async forward(request) {
        observe("native.forward", { method: request.method });
        return nativeCreator.forward(request);
      },
      async subscribe(request, signal) {
        observe("native.subscribe.start");
        try {
          const result = await nativeCreator.subscribe(request, signal);
          observe("native.subscribe.end");
          return result;
        } catch (error) {
          observe("native.subscribe.error", { error: String(error) });
          throw error;
        }
      },
      async activate(request, signal) {
        observe("native.activate.start");
        try {
          const result = await nativeCreator.activate(
            {
              ...request,
              updates: async (update) => {
                observe("native.update");
                await request.updates(update);
              },
            },
            signal,
          );
          observe("native.activate.end");
          return result;
        } catch (error) {
          observe("native.activate.error", { error: String(error) });
          throw error;
        }
      },
      async cancel(request, signal) {
        observe("native.cancel");
        return nativeCreator.cancel(request, signal);
      },
      async dispose(envelope, signal) {
        observe("native.dispose");
        return nativeCreator.dispose(envelope, signal);
      },
      close: () => Promise.resolve(),
    };
    const owner = new DynamicUnaryForwarder({
      create: () => Promise.resolve(observedNativeCreator),
    });
    await owner.reconcile([
      new ApplicationNode({ id: "message-board", endpoint: backend.baseUrl }),
    ]);
    cleanup.add("native membership", 70, () => owner.close());
    const creator = new DynamicSubscriptionCreator(owner);
    const forwardedContexts = [];
    const observedCreator = {
      async subscribe(request, signal, maxBackendEnvelopeBytes) {
        counters.subscribe += 1;
        observe("gateway.subscribe");
        forwardedContexts.push(contextSummary(fromBinary(TopicSchema, request.bytes).context));
        return creator.subscribe(request, signal, maxBackendEnvelopeBytes);
      },
      async activate(request, signal) {
        counters.activate += 1;
        counters.activeStreams += 1;
        observe("gateway.activate.start");
        try {
          return await creator.activate(
            {
              ...request,
              updates: async (update) => {
                counters.updates += 1;
                observe("gateway.update", { updates: counters.updates });
                await request.updates(update);
              },
            },
            signal,
          );
        } finally {
          counters.activeStreams -= 1;
          observe("gateway.activate.end");
        }
      },
      async cancel(request, signal) {
        counters.cancel += 1;
        observe("gateway.cancel");
        return creator.cancel(request, signal);
      },
    };
    const policy = new BoardAccessPolicy();
    const contexts = new BoardContextResolver();
    const clock = new SystemClock();
    const unary = new UnaryGateway({
      registry: typeRegistry,
      maxRequestBytes: 1_048_576,
      publicAccess: true,
      authorize: policy.authorize.bind(policy),
      contexts,
      clock,
      forward: async (request) => {
        counters.forward += 1;
        observe("gateway.forward", { method: request.method, forward: counters.forward });
        const context =
          request.method === "Post"
            ? fromBinary(CommandSchema, request.value).context?.actorContext
            : fromBinary(QuerySchema, request.value).context;
        forwardedContexts.push(contextSummary(context));
        return nativeCreator.forward(request);
      },
    });
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => globalThis.crypto.randomUUID(),
      dispose: (definition, signal) => {
        counters.dispose += 1;
        observe("gateway.dispose");
        return creator.cancel({ wire: definition }, signal);
      },
    });
    cleanup.add("subscription bindings", 80, () => bindings.close());
    const subscriptions = createSubscriptions({
      bindings,
      publicAccess: true,
      authorize: policy.authorize.bind(policy),
      contexts,
      clock,
      creator: observedCreator,
    });
    cleanup.add("subscription gateway", 85, () => subscriptions.close());
    const services = createNativeGatewayServices({
      unary,
      subscriptions,
      requests: {
        credential: () => undefined,
        transport: (context) =>
          TransportFacts.from({
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
        accessLog: true,
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
      nativeBaseUrl: backend.baseUrl,
      tls: Object.freeze({ key: join(directory, "key.pem"), cert: join(directory, "cert.pem") }),
      bindingCount: () => bindings.size,
      counters: () => Object.freeze({ ...counters }),
      forwardedContexts: () => Object.freeze(forwardedContexts.map((context) => ({ ...context }))),
      trace: () => Object.freeze(trace.map((event) => ({ ...event }))),
      async diagnosticState() {
        const envoy =
          container === undefined
            ? { container: undefined }
            : await runCommand("docker", ["inspect", "-f", "{{.State.Running}}", container])
                .then(({ stdout }) => ({ container, running: stdout.trim() }))
                .catch((error) => ({ container, inspectError: String(error) }));
        const logs =
          container === undefined
            ? ""
            : await runCommand("docker", ["logs", container])
                .then(({ stdout, stderr }) => `${stdout}${stderr}`)
                .catch((error) => String(error));
        return {
          envoy,
          logs,
          trace: trace.map((event) => ({ ...event })),
          bindings: bindings.size,
          counters: { ...counters },
        };
      },
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
const gatewaySessions = new WeakMap();

export function listen(server, port) {
  const sessions = new Set();
  gatewaySessions.set(server, sessions);
  server.on("session", (session) => {
    sessions.add(session);
    session.once("close", () => sessions.delete(session));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}
export function close(server) {
  for (const session of gatewaySessions.get(server) ?? []) session.destroy();
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
