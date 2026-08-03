import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const containerRoot = new URL(".", import.meta.url);
const datastoreEmulator =
  "gcr.io/google.com/cloudsdktool/google-cloud-cli@sha256:cda01b8c880e9161992c3fd61d7d0e153b4dd073aa4a9d62ad79243907cf8dd4";

test("local images have a fixed build contract", () => {
  assert.equal(existsSync(new URL("Dockerfile", containerRoot)), true);
  assert.equal(existsSync(new URL("build-local-images.mjs", containerRoot)), true);
  assert.equal(existsSync(join(process.cwd(), "examples/message-board/app/dist/src/combined-entry.js")), true);
  assert.equal(existsSync(join(process.cwd(), "examples/message-board/app/dist/src/application-entry.js")), true);
  const dockerfile = readFileSync(new URL("Dockerfile", containerRoot), "utf8");
  const helper = readFileSync(new URL("build-local-images.mjs", containerRoot), "utf8");
  assert.match(dockerfile, /corepack pnpm install --offline/u);
  assert.match(dockerfile, /pnpm-workspace\.yaml/u);
  assert.match(dockerfile, /ENTRYPOINT \["node"\]/u);
  assert.match(helper, /COPYFILE_DISABLE/u);
  assert.match(helper, /-exec", "xattr", "-c"/u);
  assert.match(helper, /-exec", "xattr", "-s", "-c"/u);
  assert.match(datastoreEmulator, /@sha256:[a-f0-9]{64}$/u);
});
