import console from "node:console";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = resolve(import.meta.dirname, "..");

// Documents that Wave 10 has explicitly admitted to the strict snippet gate.
export const documentedTypeScriptPaths = [
  "README.md",
  "REFERENCE.md",
  "packages/core/README.md",
  "packages/core/REFERENCE.md",
  "packages/proto/README.md",
  "packages/proto/REFERENCE.md",
  "packages/proto-tools/README.md",
  "packages/proto-tools/REFERENCE.md",
  "packages/server/README.md",
  "packages/server/REFERENCE.md",
  "packages/testing/README.md",
  "packages/testing/REFERENCE.md",
  "packages/transport/README.md",
  "packages/transport/REFERENCE.md",
  "packages/proto/proto/README.md",
  "examples/todo/README.md",
  "examples/todo/REFERENCE.md",
  "examples/todo/USER_GUIDE.md",
  "packages/auth/README.md",
  "packages/auth/REFERENCE.md",
  "packages/client-node/README.md",
  "packages/client-node/REFERENCE.md",
  "packages/client-react/README.md",
  "packages/client-react/REFERENCE.md",
  "packages/client-web/README.md",
  "packages/client-web/REFERENCE.md",
  "docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md",
  "docs/USER_GUIDE.md",
  "examples/message-board/README.md",
  "examples/message-board/REFERENCE.md",
  "examples/message-board/app/README.md",
  "examples/message-board/app/REFERENCE.md",
  "examples/message-board/model/README.md",
  "examples/message-board/model/REFERENCE.md",
  "examples/message-board/web/README.md",
  "examples/message-board/web/REFERENCE.md",
  "examples/message-board/deploy/README.md",
  "examples/message-board/deploy/REFERENCE.md",
  "examples/message-board/deploy/container/README.md",
];

const fence = /^```(?:ts|typescript)\s*\n([\s\S]*?)^```\s*$/gim;
const compilerOptions = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  noEmit: true,
  noImplicitAny: true,
  skipLibCheck: true,
  strict: true,
  target: ts.ScriptTarget.ESNext,
  types: ["node"],
};

// Extracts TypeScript fences from one Markdown source in source order.
export function extractTypeScriptSnippets(source) {
  return [...source.matchAll(fence)];
}

// Resolves a declared source context, rejecting paths outside this repository.
export function documentationSnippetFile(document, declaredPath) {
  const file = resolve(root, declaredPath);
  if (!file.startsWith(`${root}/`) || (!file.endsWith(".ts") && !file.endsWith(".tsx")))
    throw new Error(`Invalid docs-snippet-path in ${document}: ${declaredPath}`);
  if (!existsSync(file) || !statSync(file).isFile())
    throw new Error(`Missing docs-snippet-path in ${document}: ${declaredPath}`);
  return file;
}

// Runs this checker for focused fixture tests.
export function runSnippetChecker(documentsToCheck) {
  return spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...documentsToCheck], {
    cwd: root,
    encoding: "utf8",
  });
}

export function checkTypeScriptSnippets(documents) {
  const diagnostics = [];
  for (const document of [...documents].sort((left, right) => left.localeCompare(right))) {
    const markdown = resolve(root, document);
    if (!existsSync(markdown) || !statSync(markdown).isFile()) {
      diagnostics.push({ document, line: 1, message: "Missing document." });
      continue;
    }
    const source = readFileSync(markdown, "utf8");
    for (const [index, snippet] of extractTypeScriptSnippets(source).entries()) {
      const code = snippet[1];
      const line = source.slice(0, snippet.index).split("\n").length;
      let context;
      try {
        context = snippetContext(document, code, index + 1);
      } catch (error) {
        diagnostics.push({
          document,
          line,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      diagnostics.push(...compileSnippet(document, line, context, code));
    }
  }
  return diagnostics.sort(
    (left, right) =>
      left.document.localeCompare(right.document) ||
      left.line - right.line ||
      left.message.localeCompare(right.message),
  );
}

function snippetContext(document, code, index) {
  const declaredPath = /^\/\/ docs-snippet-path: ([^\n]+)$/mu.exec(code)?.[1];
  if (declaredPath !== undefined) return documentationSnippetFile(document, declaredPath);
  return resolve(root, document, "..", `.docs-snippet-${index}.ts`);
}

function compileSnippet(document, line, context, code) {
  const host = ts.createCompilerHost(compilerOptions);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  host.fileExists = (file) => file === context || originalFileExists(file);
  host.readFile = (file) => (file === context ? code : originalReadFile(file));
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) =>
    file === context
      ? ts.createSourceFile(file, code, languageVersion, true)
      : originalGetSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([context], compilerOptions, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => ({
      document,
      line,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
    }));
}

function main() {
  const documents = process.argv.slice(2);
  const diagnostics = checkTypeScriptSnippets(
    documents.length === 0 ? documentedTypeScriptPaths : documents,
  );
  for (const diagnostic of diagnostics)
    console.error(`${diagnostic.document}:${String(diagnostic.line)}: ${diagnostic.message}`);
  if (diagnostics.length > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
