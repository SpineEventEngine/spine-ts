import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const containerRoot = new URL(".", import.meta.url);

test("local images have a fixed build contract", () => {
  assert.equal(existsSync(new URL("Dockerfile", containerRoot)), true);
  assert.equal(existsSync(new URL("build-local-images.mjs", containerRoot)), true);
  assert.equal(existsSync(join(process.cwd(), "examples/message-board/app/dist/src/combined-entry.js")), true);
  assert.equal(existsSync(join(process.cwd(), "examples/message-board/app/dist/src/application-entry.js")), true);
});
