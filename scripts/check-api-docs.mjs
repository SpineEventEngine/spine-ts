import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const expectedProtoExports = [
  "FieldPath",
  "TemplateString",
  "ValidationError",
  "ConstraintViolation",
  "file_spine_options",
  "file_spine_base_field_path",
  "file_spine_string_template_string",
  "file_spine_validation_validation_error",
  "type_url_prefix",
  "FieldPathSchema",
  "TemplateStringSchema",
  "ValidationErrorSchema",
  "ConstraintViolationSchema",
];
const expectedCoreExports = [
  "DEFAULT_TYPE_URL_PREFIX",
  "TypeRegistry",
  "createSpineCoreRegistry",
  "deriveTypeUrl",
  "getTypeUrlPrefix",
  "spineCoreRegistry",
  "FileOptionExtension",
  "MessageSchema",
  "RegisterTypeOptions",
  "TypeMetadata",
  "DeriveTypeUrlOptions",
];
const protoIndexPath = join("packages", "proto", "src", "index.ts");

const typedocExecutable = process.platform === "win32" ? "typedoc.cmd" : "typedoc";
const typedocBin = join("node_modules", ".bin", typedocExecutable);
const outputDir = mkdtempSync(join(tmpdir(), "spine-typedoc-json-"));
const jsonPath = join(outputDir, "api.json");
const htmlPath = join(outputDir, "html");

const typedocResult = spawnSync(
  typedocBin,
  ["--options", "typedoc.json", "--out", htmlPath, "--json", jsonPath],
  {
    stdio: "inherit",
  },
);

if (typedocResult.error !== undefined) {
  console.error(`Failed to start TypeDoc JSON check: ${typedocResult.error.message}`);
  process.exit(1);
}

if (typedocResult.signal !== null) {
  console.error(`TypeDoc JSON check terminated by signal ${typedocResult.signal}.`);
  process.exit(1);
}

if (typedocResult.status !== 0) {
  process.exit(typedocResult.status ?? 1);
}

const apiDocs = JSON.parse(readFileSync(jsonPath, "utf8"));
const documentedNames = new Set();

function collectNames(value) {
  if (Array.isArray(value)) {
    for (const child of value) {
      collectNames(child);
    }
    return;
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  if (typeof value.name === "string") {
    documentedNames.add(value.name);
  }

  for (const child of Object.values(value)) {
    collectNames(child);
  }
}

collectNames(apiDocs);

const missingExports = expectedProtoExports.filter((name) => !documentedNames.has(name));
const missingCoreExports = expectedCoreExports.filter((name) => !documentedNames.has(name));

if (missingExports.length > 0) {
  console.error(
    `TypeDoc JSON is missing expected @spine-ts/proto exports: ${missingExports.join(", ")}`,
  );
  process.exit(1);
}

if (missingCoreExports.length > 0) {
  console.error(
    `TypeDoc JSON is missing expected @spine-ts/core exports: ${missingCoreExports.join(", ")}`,
  );
  process.exit(1);
}

const protoIndexSource = readFileSync(protoIndexPath, "utf8");

if (/export\s+\*\s+from\s+["']\.\/generated\//.test(protoIndexSource)) {
  console.error(
    "@spine-ts/proto root must not use broad generated re-exports; expose curated aliases instead.",
  );
  process.exit(1);
}

console.log(
  `TypeDoc JSON includes ${expectedProtoExports.length} expected @spine-ts/proto exports and ${expectedCoreExports.length} expected @spine-ts/core exports.`,
);
