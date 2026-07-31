import assert from "node:assert/strict";
import test from "node:test";

import { startTopology } from "./harness.mjs";

test("startup failure before the gateway listens closes every acquired resource", async () => {
  const attempts = [];
  const state = { backend: true, gateway: true };

  await assert.rejects(
    startTopology({
      lifecycle: {
        startBackend: async () => ({
          baseUrl: "http://127.0.0.1:5000",
          close: async () => {
            state.backend = false;
          },
        }),
        createGateway: () => ({}),
        listen: async () => {
          throw new Error("pre-listen failure");
        },
        closeGateway: async () => {
          state.gateway = false;
        },
        onCleanupAttempt: (label) => attempts.push(label),
      },
    }),
    /pre-listen failure/,
  );

  assert.deepEqual(state, { backend: false, gateway: false });
  assert.deepEqual(attempts.slice(0, 2), ["subscription bindings", "gateway"]);
  assert.equal(attempts.at(-1), "message board backend");
});

test("post-container startup failure removes the container before draining the gateway", async () => {
  const attempts = [];
  const state = { backend: true, gateway: true, directory: true, container: true };

  await assert.rejects(
    startTopology({ lifecycle: failedContainerLifecycle(state, attempts) }),
    /readiness failure/,
  );

  assert.deepEqual(state, { backend: false, gateway: false, directory: false, container: false });
  assert.deepEqual(attempts.slice(0, 3), ["Envoy container", "subscription bindings", "gateway"]);
  assert.equal(attempts.at(-1), "temporary TLS directory");
});

test("cleanup attempts every owned resource after one cleanup rejection", async () => {
  const attempts = [];
  const state = { backend: true, gateway: true, directory: true, container: true };
  const lifecycle = failedContainerLifecycle(state, attempts, { rejectContainerCleanup: true });

  const error = await rejected(startTopology({ lifecycle }));

  assert.ok(error instanceof AggregateError);
  assert.deepEqual(state, { backend: false, gateway: false, directory: false, container: false });
  assert.deepEqual(attempts.slice(0, 3), ["Envoy container", "subscription bindings", "gateway"]);
  assert.equal(attempts.at(-1), "temporary TLS directory");
  assert.match(error.message, /readiness failure/);
});

async function rejected(operation) {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  assert.fail("Expected operation to reject.");
}

function failedContainerLifecycle(state, attempts, { rejectContainerCleanup = false } = {}) {
  return {
    startBackend: async () => ({
      baseUrl: "http://127.0.0.1:5000",
      close: async () => {
        state.backend = false;
      },
    }),
    createGateway: () => ({}),
    listen: async () => undefined,
    closeGateway: async () => {
      state.gateway = false;
    },
    mkdtemp: async () => "/tmp/spine-e1-lifecycle",
    writeFile: async () => undefined,
    rm: async () => {
      state.directory = false;
    },
    ready: async () => {
      throw new Error("readiness failure");
    },
    run: async (command, arguments_) => {
      if (command === "docker" && arguments_[0] === "run")
        return { stdout: "container-1\n", stderr: "" };
      if (command === "docker" && arguments_[0] === "rm") {
        state.container = false;
        if (rejectContainerCleanup) throw new Error("simulated container cleanup rejection");
      }
      return { stdout: "", stderr: "" };
    },
    onCleanupAttempt: (label) => attempts.push(label),
  };
}
