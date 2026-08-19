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

test("deployment guide teaches the public-demo gateway without credential setup", () => {
  assert.doesNotMatch(deploymentReadme, /session signing|private key|bearer|sign-in/iu);
  assert.match(deploymentReadme, /request actor/iu);
  assert.match(deploymentReadme, /static reference/iu);
});
