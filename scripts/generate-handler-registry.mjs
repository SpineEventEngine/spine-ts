import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempParent = join(repoRoot, "node_modules/.cache");
const toolSources = [
  "packages/proto-tools/src/generation/build-time-handler-analyzer.ts",
  "packages/proto-tools/src/generation/generated-registry-writer.ts",
];

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  mkdirSync(tempParent, { recursive: true });
  const tempRoot = mkdtempSync(join(tempParent, "spine-handler-registry-"));

  try {
    const { BuildHandlerAnalyzer, GeneratedRegistryWriter } = await loadBuildTool(tempRoot);
    const program = createProgram(options.project, {
      redirects: options.sourceGeneratedRedirects ?? [
        {
          source: options.sourceGeneratedRoot ?? options.generatedRoot,
          staged: options.stagedSourceGeneratedRoot ?? options.generatedRoot,
        },
      ],
    });
    const analysis = BuildHandlerAnalyzer.analyze(program);

    if (analysis.diagnostics.length > 0) {
      printDiagnostics(analysis.diagnostics);
      return 1;
    }

    new GeneratedRegistryWriter().write(analysis, {
      repoRoot: options.repoRoot,
      generatedRoot: options.generatedRoot,
      outputFile: options.outputFile,
      publishedOutputFile: options.publishedOutputFile,
    });
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const options = {
    repoRoot,
    project: undefined,
    generatedRoot: undefined,
    outputFile: undefined,
    publishedOutputFile: undefined,
    sourceGeneratedRoot: undefined,
    stagedSourceGeneratedRoot: undefined,
    sourceGeneratedRedirects: undefined,
  };

  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];

    if (value === undefined) {
      throw new Error(`Missing value for ${flag ?? "unknown option"}.`);
    }

    switch (flag) {
      case "--repo-root":
        options.repoRoot = resolve(value);
        break;
      case "--project":
        options.project = resolve(value);
        break;
      case "--generated-root":
        options.generatedRoot = resolve(value);
        break;
      case "--source-generated-root":
        options.sourceGeneratedRoot = resolve(value);
        break;
      case "--staged-source-generated-root":
        options.stagedSourceGeneratedRoot = resolve(value);
        break;
      case "--source-generated-redirects":
        options.sourceGeneratedRedirects = parseGeneratedSourceRedirects(value);
        break;
      case "--out":
        options.outputFile = resolve(value);
        break;
      case "--published-out":
        options.publishedOutputFile = resolve(value);
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }

  if (
    options.project === undefined ||
    options.generatedRoot === undefined ||
    options.outputFile === undefined
  ) {
    throw new Error(
      "Usage: node scripts/generate-handler-registry.mjs --project <tsconfig> " +
        "--generated-root <generated-dir> --out <registry.ts> [--repo-root <repo>]",
    );
  }

  return options;
}

function parseGeneratedSourceRedirects(value) {
  const parsed = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    !parsed.every(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        typeof entry.source === "string" &&
        typeof entry.staged === "string" &&
        (entry.packageName === undefined || typeof entry.packageName === "string") &&
        (entry.moduleRoot === undefined || typeof entry.moduleRoot === "string"),
    )
  ) {
    throw new Error("Generated source redirects must be source/staged path pairs.");
  }
  return parsed.map((entry) => ({
    source: resolve(entry.source),
    staged: resolve(entry.staged),
    ...(entry.packageName === undefined ? {} : { packageName: entry.packageName }),
    ...(entry.moduleRoot === undefined ? {} : { moduleRoot: resolve(entry.moduleRoot) }),
  }));
}

async function loadBuildTool(tempRoot) {
  for (const sourcePath of toolSources) {
    const sourceFile = join(repoRoot, sourcePath);
    const outputFile = join(tempRoot, `${sourcePath.split("/").at(-1).replace(/\.ts$/u, "")}.mjs`);
    const source = readFileSync(sourceFile, "utf8");
    const transpiled = ts.transpileModule(source, {
      fileName: sourceFile,
      compilerOptions: {
        target: ts.ScriptTarget.ES2024,
        module: ts.ModuleKind.ES2022,
        esModuleInterop: true,
        sourceMap: false,
      },
      reportDiagnostics: true,
    });

    if ((transpiled.diagnostics ?? []).length > 0) {
      const details = ts.formatDiagnosticsWithColorAndContext(transpiled.diagnostics, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => repoRoot,
        getNewLine: () => "\n",
      });
      throw new Error(details);
    }

    writeFileSync(outputFile, transpiled.outputText, "utf8");
  }

  const analyzer = await import(
    pathToFileURL(join(tempRoot, "build-time-handler-analyzer.mjs")).href
  );
  const writer = await import(pathToFileURL(join(tempRoot, "generated-registry-writer.mjs")).href);

  return {
    BuildHandlerAnalyzer: analyzer.BuildHandlerAnalyzer,
    GeneratedRegistryWriter: writer.GeneratedRegistryWriter,
  };
}

function createProgram(project, generatedRoots) {
  const config = ts.readConfigFile(project, ts.sys.readFile);

  if (config.error !== undefined) {
    throw new Error(formatConfigDiagnostic(config.error));
  }

  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    dirname(project),
    undefined,
    project,
  );

  if (parsed.errors.length > 0) {
    throw new Error(formatConfigDiagnostics(parsed.errors));
  }

  const host = createGeneratedRootRedirectHost(parsed.options, generatedRoots.redirects);

  return ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    projectReferences: parsed.projectReferences,
    host,
  });
}

function createGeneratedRootRedirectHost(options, redirects) {
  const host = ts.createCompilerHost(options);
  const moduleRoots = new Map(
    redirects.flatMap((redirect) =>
      redirect.packageName === undefined || redirect.moduleRoot === undefined
        ? []
        : [[redirect.packageName, redirect.moduleRoot]],
    ),
  );
  host.resolveModuleNameLiterals = (
    moduleLiterals,
    containingFile,
    redirectedReference,
    compilerOptions,
  ) =>
    moduleLiterals.map((literal) => {
      for (const [packageName, moduleRoot] of moduleRoots) {
        const prefix = `${packageName}/generated/`;
        if (literal.text.startsWith(prefix) && literal.text.endsWith(".js")) {
          const source = join(moduleRoot, `${literal.text.slice(prefix.length, -".js".length)}.ts`);
          if (host.fileExists(source)) {
            return {
              resolvedModule: {
                resolvedFileName: source,
                extension: ts.Extension.Ts,
                isExternalLibraryImport: false,
              },
            };
          }
        }
      }
      return ts.resolveModuleName(
        literal.text,
        containingFile,
        compilerOptions,
        host,
        undefined,
        redirectedReference,
      );
    });

  if (redirects.every((redirect) => redirect.source === redirect.staged)) {
    return host;
  }

  const originalDirectoryExists = host.directoryExists?.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const originalRealpath = host.realpath?.bind(host);
  const redirectPath = (path) => redirectGeneratedPath(path, redirects);

  host.fileExists = (path) => originalFileExists(redirectPath(path));
  host.readFile = (path) => originalReadFile(redirectPath(path));
  if (originalDirectoryExists !== undefined) {
    host.directoryExists = (path) => originalDirectoryExists(redirectPath(path));
  }
  if (originalRealpath !== undefined) {
    host.realpath = (path) => originalRealpath(redirectPath(path));
  }

  return host;
}

function redirectGeneratedPath(path, redirects) {
  for (const redirect of redirects) {
    const value = relative(redirect.source, resolve(path));

    if (value === "") {
      return redirect.staged;
    }
    if (!value.startsWith("..") && !isAbsolute(value)) {
      return join(redirect.staged, ...value.split(sep));
    }
  }
  return path;
}

function printDiagnostics(diagnostics) {
  for (const diagnostic of diagnostics) {
    console.error(
      `${diagnostic.sourceFile}:${String(diagnostic.line)}:${String(diagnostic.column)} ` +
        `${diagnostic.code} ${diagnostic.message}`,
    );
  }
}

function formatConfigDiagnostic(diagnostic) {
  return formatConfigDiagnostics([diagnostic]);
}

function formatConfigDiagnostics(diagnostics) {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => repoRoot,
    getNewLine: () => "\n",
  });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
