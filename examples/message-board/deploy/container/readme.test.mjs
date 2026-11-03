// Keeps container instructions runnable and suitable for the public demonstration.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";

const readme = readFileSync(fileURLToPath(new URL("./README.md", import.meta.url)), "utf8");
const deploymentReadme = readFileSync(
  fileURLToPath(new URL("../README.md", import.meta.url)),
  "utf8",
);

test("managed-node documented command starts and cleans up its Delivery endpoint", () => {
  assert.match(readme, /--name message-board-delivery/u);
  assert.match(readme, /--network-alias delivery/u);
  assert.match(readme, /--env HOST=0\.0\.0\.0 --env PORT=8484/u);
  assert.match(readme, /DELIVERY_SERVER_URL=http:\/\/delivery:8484/u);
  assert.match(readme, /docker rm --force message-board-delivery/u);
});

test("deployment guide distinguishes public and protected signed admission", () => {
  assert.match(deploymentReadme, /MESSAGE_BOARD_AUTH_MODE=signed/u);
  assert.match(deploymentReadme, /MESSAGE_BOARD_SESSION_PRIVATE_KEY_PEM/u);
  assert.match(deploymentReadme, /issue-board-session/u);
  assert.match(deploymentReadme, /static reference/iu);
});
