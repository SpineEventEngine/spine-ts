import console from "node:console";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import ts from "typescript";

const documents = [
  "README.md",
  "docs/USER_GUIDE.md",
  "docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md",
  "packages/client-node/README.md",
  "packages/client-web/README.md",
  "packages/client-react/README.md",
  "packages/auth/README.md",
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
  noResolve: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ESNext,
};
const moduleExports = new Map();
let failures = 0;

for (const document of documents) {
  const source = readFileSync(resolve(root, document), "utf8");
  let snippet = 0;
  for (const match of source.matchAll(fence)) {
    snippet += 1;
    const code = match[1];
    const syntax = ts.transpileModule(code, { compilerOptions, reportDiagnostics: true });
    const publicGuide = document === "docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md";
    const semanticCode = publicGuide ? code : `${importStubs(code)}\n${code}`;
    const virtualFile = resolve(root, `.snippet-${snippet}.ts`);
    const snippetOptions = { ...compilerOptions, noResolve: !publicGuide };
    const host = ts.createCompilerHost(snippetOptions);
    const originalResolveModuleNames = host.resolveModuleNames?.bind(host);
    const originalGetSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
      fileName === virtualFile
        ? ts.createSourceFile(fileName, semanticCode, languageVersion, true)
        : originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    if (publicGuide)
      host.resolveModuleNames = (moduleNames, containingFile) =>
        moduleNames.map(
          (moduleName) =>
            publicDeclaration(moduleName) ??
            originalResolveModuleNames?.([moduleName], containingFile)[0] ??
            ts.resolveModuleName(moduleName, containingFile, snippetOptions, host).resolvedModule,
        );
    const program = ts.createProgram([virtualFile], snippetOptions, host);
    const errors = [
      ...(syntax.diagnostics ?? []).filter(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
      ),
      ...(publicGuide
        ? ts
            .getPreEmitDiagnostics(program)
            .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
        : !/"@spine-event-engine\/(client-|testing)/.test(code)
          ? []
          : ts
              .getPreEmitDiagnostics(program)
              .filter(
                (diagnostic) =>
                  diagnostic.category === ts.DiagnosticCategory.Error && diagnostic.code === 2304,
              )),
    ];
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

checkBrowserGuide();

if (failures > 0) process.exitCode = 1;

function checkBrowserGuide() {
  const document = "docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md";
  const source = readFileSync(resolve(root, document), "utf8");
  const normalized = source.replaceAll(/\s+/g, " ");
  const required = [
    "Subscriptions are hints, never authoritative or complete.",
    "Duplicate, missing, and differently ordered updates are possible.",
    "A healthy-looking transport does not prove every update arrived.",
    "intermediate history.",
    "Event gaps can occur and are not replayed in Wave 4.",
    "Cross-node subscription propagation is outside Wave 4 and remains Wave 6.",
    "protected by gateway authentication",
    "informational, not a credential",
    "Signed sessions trade local validation for delayed revocation.",
    "Revocation exists only with an explicit shared `SignedTokenRevocation`.",
    "durable/shared `SessionResolver`",
    "does not provision users or grant permissions.",
    "Provider access, refresh, and ID tokens are sensitive server-side material",
    "not instantaneously revoked",
    "customizable guidance, not framework-enforced deployment policy",
    "excludes SSR, Suspense, normalized caching, service workers, and",
    "Publication is deferred for reconsideration after all waves.",
    "partial static source/descriptor compatibility",
    "credentials: session.credentials",
    "Exact extension signatures",
    "NativeGatewayRequestContext.credential()",
    "IncomingRequests.decode",
    "typeof TransportFacts.from",
    'NativeGatewayRequestContext["credential"]',
    'NativeGatewayRequestContext["transport"]',
    "SubscriptionBindings",
    "Verified finite gateway and Envoy limits",
    "1,048,576 bytes",
    "64 messages / 1,048,576 bytes",
    "One active operation plus one queued operation is permitted; a third rejects as `binding-busy`.",
    "16 KiB",
    "Activate 0 s",
    "2 s",
  ];
  for (const phrase of required)
    if (!normalized.includes(phrase))
      fail(document, 1, `Missing required Wave 4 limitation: ${phrase}`);
  const links = [
    "docs/USER_GUIDE.md",
    "docs/api/README.md",
    "packages/auth/README.md",
    "packages/client-web/README.md",
    "packages/client-node/README.md",
    "packages/client-react/README.md",
    "examples/chat/README.md",
    "examples/chat/web/README.md",
    "interop/envoy/README.md",
  ];
  for (const path of links) {
    const linked = readFileSync(resolve(root, path), "utf8");
    if (!linked.includes("BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md"))
      fail(path, 1, "Missing authoritative browser/authentication guide link.");
  }
  if (!source.includes("ResolveContext valid-session validation is not policy authorization"))
    fail(document, 1, "Gateway matrix must distinguish ResolveContext validation from policy.");
}

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

function publicDeclaration(specifier) {
  if (!specifier.startsWith("@spine-event-engine/")) return undefined;
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
  return {
    resolvedFileName: resolve(packageDirectory, declaration),
    extension: ts.Extension.Dts,
    isExternalLibraryImport: true,
  };
}

function importStubs(code) {
  const source = ts.createSourceFile("snippet.ts", code, ts.ScriptTarget.ESNext, true);
  const imports = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const names = imports.get(statement.moduleSpecifier.text) ?? new Set();
    const clause = statement.importClause;
    if (clause?.name !== undefined) names.add(clause.name.text);
    if (clause?.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements)
        names.add((element.propertyName ?? element.name).text);
    }
    imports.set(statement.moduleSpecifier.text, names);
  }
  return [...imports]
    .map(
      ([specifier, names]) =>
        `declare module ${JSON.stringify(specifier)} { ${[...names]
          .map((name) => `export const ${name}: any;`)
          .join(" ")} }`,
    )
    .join("\n");
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
  const program = ts.createProgram([declarationPath], { ...compilerOptions, noResolve: false });
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
