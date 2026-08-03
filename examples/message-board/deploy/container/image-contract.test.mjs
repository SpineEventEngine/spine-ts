import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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

test("final images contain only runtime artifacts and no runtime secret", () => {
  const directory = mkdtempSync(join(tmpdir(), "spine-t0095-image-inspection-"));
  const sentinel = "spine-t0095-runtime-secret-sentinel";
  const images = ["message-board", "standalone-gateway", "simple-delivery-server"];
  try {
    for (const target of images) {
      const image = `spine-ts/${target}:local`;
      const config = execFileSync("docker", ["image", "inspect", image], { encoding: "utf8" });
      assert.doesNotMatch(config, new RegExp(sentinel, "u"));
      assert.match(config, /"Entrypoint":\s*\[\s*"node"/u);
      const history = execFileSync("docker", ["history", "--no-trunc", image], { encoding: "utf8" });
      assert.doesNotMatch(history, new RegExp(sentinel, "u"));
      const container = execFileSync("docker", ["create", "--env", `T0095_SECRET=${sentinel}`, image], {
        encoding: "utf8",
      }).trim();
      const archive = join(directory, `${target}.tar`);
      try {
        execFileSync("sh", ["-c", `docker export ${container} > ${archive}`]);
        const files = execFileSync("tar", ["-tf", archive], { encoding: "utf8" });
        assert.doesNotMatch(files, /(^|\/)(tarballs|\.git|pnpm-store|tests?)(\/|$)|\.ts(?:$|\n)|\.map(?:$|\n)|\.proto(?:$|\n)/u);
        assert.doesNotMatch(files, new RegExp(sentinel, "u"));
      } finally {
        execFileSync("docker", ["container", "rm", "-f", container]);
      }
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
