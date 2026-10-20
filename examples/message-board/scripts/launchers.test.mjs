// Verifies local launcher contracts without starting Docker or Node children.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL, fileURLToPath } from "node:url";
import process from "node:process";
import test from "node:test";
import net from "node:net";
import { clearTimeout, setTimeout } from "node:timers";

const local = readFileSync(new URL("./start-local-multi-process.sh", import.meta.url), "utf8");
const single = readFileSync(new URL("./start-local-single-process.sh", import.meta.url), "utf8");

test("single-process launcher keeps UI and Gateway ports aligned", () => {
  assert.match(single, /MESSAGE_BOARD_LOCAL_PORT/u);
  assert.match(single, /MESSAGE_BOARD_WEB_PORT/u);
  assert.match(single, /--strictPort/u);
  assert.match(single, /VITE_MESSAGE_BOARD_GATEWAY_URL="http:\/\/127\.0\.0\.1:\$gateway_port"/u);
  assert.match(single, /--port "\$web_port"/u);
  assert.match(
    single,
    /node "\$root\/examples\/message-board\/web\/node_modules\/vite\/bin\/vite\.js"/u,
  );
  assert.doesNotMatch(single, /pnpm .*exec vite/u);
});

test(
  "single-process launcher releases both direct child ports after SIGTERM",
  { timeout: 25_000 },
  async () => {
    const temp = mkdtempSync(join(tmpdir(), "message-board-shutdown-"));
    const bin = join(temp, "bin");
    mkdirSync(bin);
    const pnpm = join(bin, "pnpm");
    writeFileSync(pnpm, "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(pnpm, 0o755);
    const appPort = await unusedPort();
    let webPort = await unusedPort();
    while (webPort === appPort) webPort = await unusedPort();
    const child = spawn(
      "bash",
      [fileURLToPath(new URL("./start-local-single-process.sh", import.meta.url))],
      {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          MESSAGE_BOARD_LOCAL_PORT: String(appPort),
          MESSAGE_BOARD_WEB_PORT: String(webPort),
        },
      },
    );
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (output += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (output += chunk));
    const exited = new Promise((resolve) =>
      child.once("exit", (code, signal) => resolve({ code, signal })),
    );
    try {
      const deadline = Date.now() + 12_000;
      let ready = false;
      while (Date.now() < deadline) {
        try {
          const response = await globalThis.fetch(`http://127.0.0.1:${String(webPort)}`, {
            signal: globalThis.AbortSignal.timeout(500),
          });
          if (response.ok) {
            ready = true;
            break;
          }
        } catch {
          /* Startup is still in progress. */
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(ready, true, output);
      child.kill("SIGTERM");
      let timeout;
      const ended = await Promise.race([
        exited,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("launcher did not exit")), 7_000);
        }),
      ]).finally(() => clearTimeout(timeout));
      assert.equal(ended.code, 143, output);
      await bindPort(appPort);
      await bindPort(webPort);
    } finally {
      if (child.pid !== undefined)
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* The recorded process group exited. */
        }
      rmSync(temp, { recursive: true, force: true });
    }
  },
);

function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => (error === undefined ? resolve(address.port) : reject(error)));
    });
  });
}

function bindPort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  });
}

test("launchers reject invalid ports before starting services", () => {
  for (const [script, environment] of [
    ["start-local-single-process.sh", { MESSAGE_BOARD_LOCAL_PORT: "70000" }],
    ["start-local-multi-process.sh", { MESSAGE_BOARD_DELIVERY_PORT: "70000" }],
  ]) {
    const result = spawnSync("bash", [fileURLToPath(new URL(script, import.meta.url))], {
      env: { ...process.env, ...environment },
      encoding: "utf8",
      timeout: 2_000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ports must be between 1 and 65535/u);
  }
});

test("managed multi-process launcher owns one shared Delivery server", () => {
  assert.match(local, /MESSAGE_BOARD_DELIVERY_PORT/u);
  assert.match(local, /MESSAGE_BOARD_DATASTORE_PORT/u);
  assert.match(local, /MESSAGE_BOARD_COORDINATOR_PORT/u);
  assert.match(local, /MESSAGE_BOARD_GATEWAY_PORT/u);
  assert.match(local, /MESSAGE_BOARD_WEB_PORT/u);
  assert.match(local, /--strictPort/u);
  assert.match(local, /MESSAGE_BOARD_DELIVERY_SHARD_COUNT/u);
  assert.match(local, /MESSAGE_BOARD_IMAGE_TAG/u);
  assert.match(local, /images:build:local --target simple-delivery-server/u);
  assert.match(local, /delivery_id=\$\(docker run --detach/u);
  assert.match(local, /--env HOST=0\.0\.0\.0 --env PORT=8484/u);
  assert.match(local, /docker logs "\$delivery_id"/u);
  assert.match(local, /DELIVERY_SERVER_URL="http:\/\/127\.0\.0\.1:\$delivery_port"/u);
  assert.match(local, /DATASTORE_EMULATOR_HOST="127\.0\.0\.1:\$datastore_port"/u);
  assert.match(local, /PROCESS_COUNT="\$process_count"/u);
  assert.match(local, /DELIVERY_SHARD_COUNT="\$shard_count"/u);
  assert.match(local, /BROWSER_ORIGIN="http:\/\/127\.0\.0\.1:\$web_port"/u);
  assert.match(local, /BACKEND_URLS="http:\/\/127\.0\.0\.1:\$coordinator_port"/u);
  assert.match(local, /NODE_ENV=production/u);
  assert.match(
    local,
    /node "\$root\/examples\/message-board\/app\/dist\/src\/multi-process-app\.js"/u,
  );
  assert.doesNotMatch(local, /start:multi-process/u);
});

test("local launcher refuses to start Gateway or UI after its Coordinator exits", () => {
  const temp = mkdtempSync(join(tmpdir(), "message-board-launcher-"));
  const bin = join(temp, "bin");
  const log = join(temp, "log");
  try {
    writeFileSync(log, "", "utf8");
    writeFileSync(join(temp, "setup"), "", "utf8");
    for (const [name, body] of Object.entries({
      docker:
        '#!/usr/bin/env bash\necho docker:$1 >>$HARNESS_LOG\n[[ "$1" == run ]] && { echo captured-id; exit 0; }\n[[ "$1" == logs ]] && { echo "Delivery server listening"; exit 0; }\n[[ "$1" == inspect ]] && { echo true; exit 0; }\nexit 0\n',
      curl: "#!/usr/bin/env bash\nexit 0\n",
      node: '#!/usr/bin/env bash\necho "node:$*" >>$HARNESS_LOG\n[[ "$1" == -e ]] && { echo fixed-id; exit 0; }\nexit 1\n',
      pnpm: '#!/usr/bin/env bash\necho "pnpm:$*" >>$HARNESS_LOG\nexit 0\n',
    })) {
      const path = join(bin, name);
      mkdirSync(bin, { recursive: true });
      writeFileSync(path, body);
      chmodSync(path, 0o755);
    }
    const result = spawnSync(
      "bash",
      [fileURLToPath(new URL("./start-local-multi-process.sh", import.meta.url))],
      {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          HARNESS_LOG: log,
          MESSAGE_BOARD_REPO_ROOT: temp,
        },
        encoding: "utf8",
        timeout: 5_000,
      },
    );
    assert.notEqual(result.status, 0);
    const calls = readFileSync(log, "utf8");
    assert.match(calls, /node:.*multi-process-app\.js/u, result.stderr);
    assert.doesNotMatch(calls, /gateway-server|web/u);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test(
  "multi-process launcher releases its direct app, Gateway, and UI ports",
  { timeout: 25_000 },
  async () => {
    const temp = mkdtempSync(join(tmpdir(), "message-board-multi-shutdown-"));
    const bin = join(temp, "bin");
    mkdirSync(bin);
    for (const [name, body] of Object.entries({
      pnpm: "#!/usr/bin/env bash\nexit 0\n",
      docker:
        '#!/usr/bin/env bash\ncase "$1" in run) echo fake-container ;; logs) echo "Delivery server listening" ;; inspect) echo true ;; esac\nexit 0\n',
      curl: "#!/usr/bin/env bash\nexit 0\n",
    })) {
      const path = join(bin, name);
      writeFileSync(path, body);
      chmodSync(path, 0o755);
    }
    for (const [path, ready, selectedPort] of [
      [
        "examples/message-board/app/dist/src/multi-process-app.js",
        "MessageBoard managed coordinator ready",
        "process.env.PORT",
      ],
      [
        "examples/message-board/app/dist/src/gateway-server.js",
        "MessageBoard gateway ready",
        "process.env.PORT",
      ],
      [
        "examples/message-board/web/node_modules/vite/bin/vite.js",
        "Vite ready",
        "process.argv[process.argv.indexOf('--port') + 1]",
      ],
    ]) {
      const file = join(temp, path);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(
        file,
        `const http=require('node:http');const server=http.createServer((_,res)=>res.end('ready'));server.listen(Number(${selectedPort}),'127.0.0.1',()=>console.log('${ready}'));process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`,
      );
    }
    const ports = new Set();
    while (ports.size < 5) ports.add(await unusedPort());
    const [deliveryPort, datastorePort, appPort, gatewayPort, webPort] = [...ports];
    const child = spawn(
      "bash",
      [fileURLToPath(new URL("./start-local-multi-process.sh", import.meta.url))],
      {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          MESSAGE_BOARD_REPO_ROOT: temp,
          MESSAGE_BOARD_DELIVERY_PORT: String(deliveryPort),
          MESSAGE_BOARD_DATASTORE_PORT: String(datastorePort),
          MESSAGE_BOARD_COORDINATOR_PORT: String(appPort),
          MESSAGE_BOARD_GATEWAY_PORT: String(gatewayPort),
          MESSAGE_BOARD_WEB_PORT: String(webPort),
        },
      },
    );
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (output += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (output += chunk));
    const exited = new Promise((resolve) =>
      child.once("exit", (code, signal) => resolve({ code, signal })),
    );
    try {
      for (const port of [appPort, gatewayPort, webPort]) {
        const deadline = Date.now() + 10_000;
        let ready = false;
        while (Date.now() < deadline) {
          try {
            const response = await globalThis.fetch(`http://127.0.0.1:${String(port)}`, {
              signal: globalThis.AbortSignal.timeout(500),
            });
            if (response.ok) {
              ready = true;
              break;
            }
          } catch {
            /* The direct child is starting. */
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.equal(ready, true, `${String(port)} was not ready: ${output}`);
      }
      child.kill("SIGTERM");
      let timer;
      const ended = await Promise.race([
        exited,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("multi-process launcher did not exit")), 7_000);
        }),
      ]).finally(() => clearTimeout(timer));
      assert.equal(ended.code, 143, output);
      for (const port of [appPort, gatewayPort, webPort]) await bindPort(port);
    } finally {
      if (child.pid !== undefined)
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* The recorded process group exited. */
        }
      rmSync(temp, { recursive: true, force: true });
    }
  },
);
