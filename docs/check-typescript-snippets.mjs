import console from "node:console";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import ts from "typescript";

const documents = [
  "README.md",
  "docs/USER_GUIDE.md",
  "packages/client-node/README.md",
  "packages/delivery-client/README.md",
  "packages/delivery-server/README.md",
  "packages/proto/README.md",
  "packages/proto-tools/README.md",
  "packages/server/README.md",
  "packages/testing/README.md",
  "examples/chat/README.md",
];
const fence = /^```ts\n([\s\S]*?)^```$/gm;
const root = resolve(import.meta.dirname, "..");
const compilerOptions = {
  experimentalDecorators: true,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ESNext,
};
const moduleExports = new Map();
let failures = 0;

for (const document of documents) {
  const source = readFileSync(resolve(root, document), "utf8");
  for (const match of source.matchAll(fence)) {
    const code = match[1];
    const result = ts.transpileModule(code, { compilerOptions, reportDiagnostics: true });
    const errors = result.diagnostics?.filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    );
    const line = source.slice(0, match.index).split("\n").length;
    if (errors !== undefined && errors.length > 0) {
      failures += 1;
      for (const error of errors) {
        console.error(
          `${document}:${String(line)}: ${ts.flattenDiagnosticMessageText(error.messageText, " ")}`,
        );
      }
    }
    checkSpineImports(code, resolve(root, document), document, line);
  }
}

if (failures > 0) process.exitCode = 1;

function checkSpineImports(code, containingFile, document, line) {
  const source = ts.createSourceFile(containingFile, code, ts.ScriptTarget.ESNext, true);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith("@spine-event-engine/")) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    const exported = exportsFor(specifier);
    if (exported === undefined) {
      fail(document, line, `Cannot resolve public declaration for ${specifier}.`);
      continue;
    }
    for (const binding of bindings.elements) {
      const imported = (binding.propertyName ?? binding.name).text;
      if (!exported.has(imported))
        fail(document, line, `${specifier} does not export ${imported}.`);
    }
  }
}

function exportsFor(specifier) {
  const cached = moduleExports.get(specifier);
  if (cached !== undefined) return cached;
  const parts = specifier.split("/");
  const packageDirectory = resolve(
    root,
    ["users-model", "chat-model"].includes(parts[1]) ? "examples" : "packages",
    parts[1],
  );
  const manifest = JSON.parse(readFileSync(resolve(packageDirectory, "package.json"), "utf8"));
  const subpath = parts.length === 2 ? "." : `./${parts.slice(2).join("/")}`;
  const entry = exportedEntry(manifest.exports, subpath);
  const declaration = typeof entry === "string" ? entry : entry?.types;
  if (typeof declaration !== "string") return undefined;
  const declarationPath = resolve(packageDirectory, declaration);
  const program = ts.createProgram([declarationPath], compilerOptions);
  const source = program.getSourceFile(declarationPath);
  const symbol =
    source === undefined ? undefined : program.getTypeChecker().getSymbolAtLocation(source);
  if (symbol === undefined) return undefined;
  const exported = new Set(
    program
      .getTypeChecker()
      .getExportsOfModule(symbol)
      .map((entry) => entry.name),
  );
  moduleExports.set(specifier, exported);
  return exported;
}

function exportedEntry(exports, subpath) {
  const exact = exports?.[subpath];
  if (exact !== undefined) return exact;
  for (const [pattern, entry] of Object.entries(exports ?? {})) {
    const marker = pattern.indexOf("*");
    if (marker < 0) continue;
    const prefix = pattern.slice(0, marker);
    const suffix = pattern.slice(marker + 1);
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    const wildcard = subpath.slice(prefix.length, subpath.length - suffix.length);
    if (typeof entry === "string") return entry.replace("*", wildcard);
    if (typeof entry?.types === "string")
      return { ...entry, types: entry.types.replace("*", wildcard) };
  }
  return undefined;
}

function fail(document, line, message) {
  failures += 1;
  console.error(`${document}:${String(line)}: ${message}`);
}
