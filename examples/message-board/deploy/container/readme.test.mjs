import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const readme = readFileSync(fileURLToPath(new URL("./README.md", import.meta.url)), "utf8");

test("managed-node documented command starts and cleans up its Delivery endpoint", () => {
  assert.match(readme, /--name message-board-delivery/u);
  assert.match(readme, /--network-alias delivery/u);
  assert.match(readme, /--env HOST=0\.0\.0\.0 --env PORT=8484/u);
  assert.match(readme, /DELIVERY_SERVER_URL=http:\/\/delivery:8484/u);
  assert.match(readme, /docker rm --force message-board-delivery/u);
});
