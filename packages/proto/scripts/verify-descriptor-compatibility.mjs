import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import console from "node:console";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "..", "..");

function descriptorSetClone(descriptorSet) {
  return fromBinary(FileDescriptorSetSchema, toBinary(FileDescriptorSetSchema, descriptorSet));
}

/**
 * Produces the canonical binary comparison form for a complete descriptor set.
 *
 * `source_code_info` is deliberately the sole omitted field: it is source
 * location metadata, not a wire/API compatibility contract. All other known
 * and unknown fields remain in the Protobuf binary form, including custom
 * options such as Spine's type-URL extension.
 */
export function normalizeDescriptorSet(descriptorSet) {
  const normalized = descriptorSetClone(descriptorSet);

  for (const file of normalized.file) {
    file.sourceCodeInfo = undefined;
  }
  normalized.file.sort((left, right) => left.name.localeCompare(right.name));

  return toBinary(FileDescriptorSetSchema, normalized);
}

export function compareNormalizedDescriptorSets(expected, actual) {
  return {
    equal: Buffer.compare(normalizeDescriptorSet(expected), normalizeDescriptorSet(actual)) === 0,
  };
}

export function normalizedDescriptorDigest(descriptorSet) {
  return createHash("sha256").update(normalizeDescriptorSet(descriptorSet)).digest("hex");
}

export function buildDescriptorSet(root = repoRoot) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "spine-descriptor-set-"));
  const outputPath = join(temporaryDirectory, "frozen.binpb");
  const localBuf = join(
    root,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "buf.cmd" : "buf",
  );
  const executable = existsSync(localBuf) ? localBuf : "buf";

  try {
    const result = spawnSync(
      executable,
      [
        "build",
        "packages/proto/proto",
        "--as-file-descriptor-set",
        "--exclude-source-info",
        "-o",
        outputPath,
      ],
      { cwd: root, encoding: "utf8" },
    );

    if (result.error !== undefined) {
      throw new Error(`Unable to start Buf descriptor build: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(`Buf descriptor build failed:\n${result.stderr || result.stdout}`);
    }

    return fromBinary(FileDescriptorSetSchema, readFileSync(outputPath));
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

export function verifyFrozenDescriptorCompatibility(root = repoRoot) {
  const descriptorSet = buildDescriptorSet(root);
  const expectedDigest = readFileSync(
    resolve(root, "packages/proto/proto/frozen-descriptor-set.sha256"),
    "utf8",
  )
    .trim()
    .split(/\s+/u)[0];
  const actualDigest = normalizedDescriptorDigest(descriptorSet);

  if (!/^[0-9a-f]{64}$/u.test(expectedDigest)) {
    throw new Error("Frozen descriptor digest must begin with a lowercase SHA-256 value.");
  }
  if (actualDigest !== expectedDigest) {
    throw new Error(
      `Frozen descriptor compatibility mismatch: expected ${expectedDigest}, got ${actualDigest}.`,
    );
  }

  return { actualDigest, fileCount: descriptorSet.file.length };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = verifyFrozenDescriptorCompatibility();
    console.log(
      `Verified ${result.fileCount} frozen descriptor files against normalized digest ${result.actualDigest}.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
