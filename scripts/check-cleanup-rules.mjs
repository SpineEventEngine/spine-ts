import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const maxLineLength = 120;
const maxSemanticComponents = 4;
const generatedNamePatterns = [/^file_spine_/, /^generated[A-Z]/, /^[A-Z0-9_]+$/];
const inheritedSemanticNameExceptionOccurrences = new Set(
  [
    [
      "applicationsByEventFullTypeName",
      "packages/server/src/handler/event-registration-readiness.ts",
      122,
    ],
    [
      "applicationsByEventFullTypeName",
      "packages/server/src/handler/event-registration-readiness.ts",
      147,
    ],
    [
      "assigneesByCommandFullTypeName",
      "packages/server/src/handler/command-registration-readiness.ts",
      61,
    ],
    [
      "assigneesByCommandFullTypeName",
      "packages/server/src/handler/command-registration-readiness.ts",
      85,
    ],
    [
      "BoundedContextRepositoryRegistrationError",
      "packages/server/src/context/bounded-context.ts",
      49,
    ],
    [
      "BoundedContextRepositoryRegistrationErrorCode",
      "packages/server/src/context/bounded-context.ts",
      42,
    ],
    [
      "BoundedContextRepositoryRegistrationOperation",
      "packages/server/src/context/bounded-context.ts",
      46,
    ],
    ["cloneRepositoryFieldMetadataList", "packages/server/src/context/bounded-context.ts", 435],
    ["createCommandRuntimeRoutingPlan", "packages/server/src/runtime/runtime-routing.ts", 170],
    ["createEventRuntimeRoutingPlan", "packages/server/src/runtime/runtime-routing.ts", 248],
    ["createInMemoryStorageAdapter", "packages/storage/src/index.ts", 237],
    ["createServerRuntimeRoutingPlan", "packages/server/src/runtime/runtime-routing.ts", 154],
    [
      "createSetOnceTransitionRule",
      "packages/server/src/entity/entity-transition-validation.ts",
      96,
    ],
    ["createZeroMqAdapterConfig", "packages/transport/src/zeromq/adapter-config.ts", 24],
    ["DeferredServerRuntimeRoutingSeam", "packages/server/src/runtime/runtime-routing.ts", 31],
    ["entityStateFullTypeName", "packages/server/src/handler/handler-metadata.ts", 222],
    ["entityStateFullTypeName", "packages/server/src/handler/handler-metadata.ts", 237],
    ["entityStateFullTypeName", "packages/server/src/handler/handler-metadata.ts", 334],
    ["entityStateFullTypeName", "packages/server/src/handler/handler-metadata.ts", 365],
    ["entityStateFullTypeName", "packages/server/src/handler/handler-metadata.ts", 534],
    [
      "EntityStateTransitionValidationRequest",
      "packages/server/src/entity/entity-transition-validation.ts",
      28,
    ],
    [
      "EntityStateTransitionValidationResult",
      "packages/server/src/entity/entity-transition-validation.ts",
      40,
    ],
    [
      "EntityTransactionCommittedVersionMetadata",
      "packages/server/src/entity/entity-transaction.ts",
      26,
    ],
    ["EntityTransactionDraftStateError", "packages/server/src/entity/entity-transaction.ts", 161],
    ["EntityTransactionDraftStateReason", "packages/server/src/entity/entity-transaction.ts", 49],
    ["eventReceiverGroupToHandlerKind", "packages/server/src/runtime/runtime-routing.ts", 143],
    ["expectedMessageFullTypeName", "packages/server/src/runtime/runtime-routing.ts", 589],
    ["fieldValueShapeIsSafe", "packages/server/src/entity/entity-transition-validation.ts", 204],
    [
      "fieldValueShapeIsSafeUnchecked",
      "packages/server/src/entity/entity-transition-validation.ts",
      212,
    ],
    ["findEntityHandlersByState", "packages/server/src/handler/handler-metadata.ts", 334],
    ["findHandlersByMessageFullTypeName", "packages/server/src/handler/handler-metadata.ts", 350],
    ["HandlerMetadataRegistryErrorCode", "packages/server/src/handler/handler-metadata.ts", 187],
    [
      "hasOnlyDenseIndexedDataProperties",
      "packages/server/src/entity/entity-transition-validation.ts",
      388,
    ],
    ["InMemoryAggregateEventStore", "packages/storage/src/index.ts", 354],
    ["InMemoryDiagnosticRecordStore", "packages/storage/src/index.ts", 414],
    ["InMemoryTenantIndexStore", "packages/storage/src/index.ts", 400],
    [
      "isAuthenticCommandRegistrationReadiness",
      "packages/server/src/handler/command-registration-readiness.ts",
      132,
    ],
    [
      "isAuthenticEventRegistrationReadiness",
      "packages/server/src/handler/event-registration-readiness.ts",
      239,
    ],
    [
      "isUnsupportedSetOnceField",
      "packages/server/src/entity/entity-transition-validation.ts",
      431,
    ],
    ["NonPlainEntityVersionMetadata", "packages/server/src/entity/entity.ts", 75],
    ["nonPlainVersionMetadataError", "packages/server/src/entity/entity.ts", 790],
    ["PlainEntityVersionMetadataAtDepth", "packages/server/src/entity/entity.ts", 102],
    [
      "reactorsByEventFullTypeName",
      "packages/server/src/handler/event-registration-readiness.ts",
      121,
    ],
    [
      "reactorsByEventFullTypeName",
      "packages/server/src/handler/event-registration-readiness.ts",
      146,
    ],
    ["readCanonicalRepositorySemanticTags", "packages/server/src/context/bounded-context.ts", 771],
    ["readRepositoryEntityTypeOption", "packages/server/src/repository/repository.ts", 256],
    ["readSafeUint8ArrayBytes", "packages/server/src/entity/entity-transition-validation.ts", 361],
    [
      "registeredCommandMessageFullTypeNames",
      "packages/server/src/handler/command-registration-readiness.ts",
      118,
    ],
    [
      "registeredEventMessageFullTypeNames",
      "packages/server/src/handler/event-registration-readiness.ts",
      207,
    ],
    ["ServerRuntimeRouteMessageDescriptor", "packages/server/src/runtime/runtime-routing.ts", 41],
    ["ServerRuntimeRouteTransportReference", "packages/server/src/runtime/runtime-routing.ts", 48],
    ["ServerRuntimeRoutingPlanInput", "packages/server/src/runtime/runtime-routing.ts", 21],
    ["ServerRuntimeStateErrorCode", "packages/server/src/runtime/runtime.ts", 62],
    [
      "subscribersByEventFullTypeName",
      "packages/server/src/handler/event-registration-readiness.ts",
      117,
    ],
    [
      "subscribersByEventFullTypeName",
      "packages/server/src/handler/event-registration-readiness.ts",
      145,
    ],
    ["topicByEventFullTypeName", "packages/server/src/runtime/runtime-routing.ts", 265],
    ["TransactionalEntityScopeErrorReason", "packages/server/src/entity/entity.ts", 26],
    [
      "validateCanonicalRepositorySemanticTagList",
      "packages/server/src/context/bounded-context.ts",
      807,
    ],
    ["validateRepositoryFieldMetadataList", "packages/server/src/context/bounded-context.ts", 757],
    ["ZeroMqAdapterConfigInput", "packages/transport/src/zeromq/adapter-config.ts", 9],
  ].map(([name, file, line]) => `${name}|${file}|${line}`),
);
const allowedFlatPackageSourceFiles = new Set([
  "packages/core/src/index.ts",
  "packages/proto/src/index.ts",
  "packages/server/src/index.ts",
  "packages/storage/src/index.ts",
  "packages/testing/src/index.ts",
  "packages/transport/src/index.ts",
]);

function parseArgs(argv) {
  const repoRootFlagIndex = argv.indexOf("--repo-root");

  if (repoRootFlagIndex < 0) {
    return { repoRoot: defaultRepoRoot };
  }

  const repoRoot = argv[repoRootFlagIndex + 1];

  if (repoRoot === undefined || repoRoot.startsWith("--")) {
    throw new Error("--repo-root requires a path argument.");
  }

  return { repoRoot: resolve(repoRoot) };
}

function runGit(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.error !== undefined) {
    throw new Error(`Failed to run git ${args.join(" ")}: ${result.error.message}`);
  }

  if (result.signal !== null) {
    throw new Error(`git ${args.join(" ")} terminated by signal ${result.signal}.`);
  }

  return result;
}

function trackedFiles(repoRoot) {
  const result = runGit(repoRoot, ["ls-files"]);

  if (result.status !== 0) {
    throw new Error(`git ls-files failed:\n${result.stderr}${result.stdout}`);
  }

  return result.stdout.split("\n").filter(Boolean);
}

function packageDirs(repoRoot) {
  const packagesRoot = join(repoRoot, "packages");

  if (!existsSync(packagesRoot)) {
    return [];
  }

  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join("packages", entry.name))
    .filter((packageDir) => existsSync(join(repoRoot, packageDir, "package.json")));
}

function findFiles(root, predicate) {
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);

    if (entry.isDirectory()) {
      return findFiles(path, predicate);
    }

    return entry.isFile() && predicate(path) ? [path] : [];
  });
}

function toRepoPath(repoRoot, path) {
  return relative(repoRoot, path).split(sep).join("/");
}

function checkGeneratedLayout(repoRoot, files, packages) {
  const failures = [];
  const srcGeneratedFiles = files.filter((file) => /^packages\/[^/]+\/src\/generated\//.test(file));
  const generatedTrackedFiles = files.filter((file) => /^packages\/[^/]+\/generated\//.test(file));

  if (srcGeneratedFiles.length > 0) {
    failures.push({
      title: "tracked generated files under package src",
      details: srcGeneratedFiles,
    });
  }

  if (generatedTrackedFiles.length > 0) {
    failures.push({
      title: "tracked generated files under packages/*/generated",
      details: generatedTrackedFiles,
    });
  }

  const notIgnored = packages.filter((packageDir) => {
    const sentinel = `${packageDir}/generated/.cleanup-enforcement-check`;
    const result = runGit(repoRoot, ["check-ignore", "--quiet", "--", sentinel]);

    return result.status !== 0;
  });

  if (notIgnored.length > 0) {
    failures.push({
      title: "generated directories not ignored by Git",
      details: notIgnored.map((packageDir) => `${packageDir}/generated/`),
    });
  }

  return failures;
}

function checkPackageTests(repoRoot, packages) {
  const srcTests = packages.flatMap((packageDir) =>
    findFiles(join(repoRoot, packageDir, "src"), (path) => path.endsWith(".test.ts")).map((path) =>
      toRepoPath(repoRoot, path),
    ),
  );

  return srcTests.length === 0
    ? []
    : [{ title: "package test files under src", details: srcTests }];
}

function authoredCodeFiles(files) {
  return files.filter((file) => {
    if (!/^(packages\/[^/]+\/(src|test)\/|scripts\/)/.test(file)) {
      return false;
    }

    if (!/\.(ts|mjs)$/.test(file)) {
      return false;
    }

    return !file.includes("/generated/") && !file.endsWith(".test.mjs");
  });
}

function packageSourceFiles(files) {
  return files.filter(
    (file) =>
      /^packages\/[^/]+\/src\//.test(file) &&
      file.endsWith(".ts") &&
      !file.includes("/generated/") &&
      !file.endsWith(".test.ts"),
  );
}

function checkLineLength(repoRoot, files) {
  const longLines = files.flatMap((file) => {
    const lines = readFileSync(join(repoRoot, file), "utf8").split(/\r?\n/);

    return lines
      .map((line, index) => ({ file, lineNumber: index + 1, length: line.length }))
      .filter(({ length }) => length > maxLineLength)
      .map(({ file: path, lineNumber, length }) => `${path}:${lineNumber} (${length})`);
  });

  return longLines.length === 0
    ? []
    : [{ title: "lines longer than 120 characters", details: longLines }];
}

function checkFlatSourceGrowth(files) {
  const newFlatFiles = files.filter(
    (file) =>
      /^packages\/[^/]+\/src\/[^/]+\.ts$/.test(file) &&
      !file.endsWith(".test.ts") &&
      !file.endsWith("/src/index.ts") &&
      !allowedFlatPackageSourceFiles.has(file),
  );

  return newFlatFiles.length === 0
    ? []
    : [{ title: "package src files must not grow flat", details: newFlatFiles }];
}

function semanticComponents(name) {
  const trimmed = name.replace(/^_+/, "");

  if (trimmed.length === 0 || generatedNamePatterns.some((pattern) => pattern.test(trimmed))) {
    return [];
  }

  return trimmed
    .split("_")
    .flatMap((part) => part.match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])/g) ?? [])
    .filter(Boolean);
}

function isAllowedInheritedSemanticName(name, file, line) {
  return inheritedSemanticNameExceptionOccurrences.has(`${name}|${file}|${line}`);
}

function hasCallbackType(node) {
  if (node.type === undefined) {
    return false;
  }

  return isVoidFunctionType(node.type) || node.type.getText().endsWith("Callback");
}

function isVoidFunctionType(type) {
  if (!ts.isFunctionTypeNode(type) || type.type === undefined) {
    return false;
  }

  return type.type.kind === ts.SyntaxKind.VoidKeyword;
}

function readIdentifierName(name) {
  return ts.isIdentifier(name) ? name.text : undefined;
}

function checkTypeScriptNames(repoRoot, files) {
  const semanticViolations = [];
  const callbackTypeViolations = [];
  const callbackNameViolations = [];

  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      readFileSync(join(repoRoot, file), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    function checkName(name, node) {
      if (name === undefined) {
        return;
      }

      const components = semanticComponents(name);

      if (components.length > maxSemanticComponents) {
        const position = source.getLineAndCharacterOfPosition(node.getStart(source));
        const line = position.line + 1;

        if (isAllowedInheritedSemanticName(name, file, line)) {
          return;
        }

        semanticViolations.push(`${file}:${line} ${name} (${components.length} components)`);
      }
    }

    function visit(node) {
      if (
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isFunctionDeclaration(node)
      ) {
        const name = node.name?.text;
        checkName(name, node);

        if (name?.endsWith("Callback") === true && !name.startsWith("On")) {
          const position = source.getLineAndCharacterOfPosition(node.name.getStart(source));
          callbackTypeViolations.push(`${file}:${position.line + 1} ${name}`);
        }
      }

      if (
        ts.isMethodDeclaration(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isVariableDeclaration(node)
      ) {
        checkName(readIdentifierName(node.name), node);
      }

      if (ts.isParameter(node)) {
        const name = readIdentifierName(node.name);

        checkName(name, node);

        if (
          name !== undefined &&
          name !== "callback" &&
          !name.startsWith("on") &&
          hasCallbackType(node)
        ) {
          const position = source.getLineAndCharacterOfPosition(node.name.getStart(source));
          callbackNameViolations.push(`${file}:${position.line + 1} ${name}`);
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(source);
  }

  return [
    semanticViolations.length > 0 && {
      title: "semantic name components exceed 4",
      details: semanticViolations,
    },
    callbackTypeViolations.length > 0 && {
      title: "callback type names must start with On",
      details: callbackTypeViolations,
    },
    callbackNameViolations.length > 0 && {
      title: "callback names must start with on",
      details: callbackNameViolations,
    },
  ].filter(Boolean);
}

function printFailures(failures) {
  for (const failure of failures) {
    console.error(`Cleanup enforcement failed: ${failure.title}`);

    for (const detail of failure.details.slice(0, 40)) {
      console.error(`  - ${detail}`);
    }

    if (failure.details.length > 40) {
      console.error(`  - ... ${failure.details.length - 40} more`);
    }
  }
}

export function checkCleanupRules(repoRoot) {
  const root = resolve(repoRoot);
  const files = trackedFiles(root);
  const packages = packageDirs(root);
  const codeFiles = authoredCodeFiles(files);

  return [
    ...checkGeneratedLayout(root, files, packages),
    ...checkPackageTests(root, packages),
    ...checkFlatSourceGrowth(files),
    ...checkLineLength(root, codeFiles),
    ...checkTypeScriptNames(root, packageSourceFiles(files)),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { repoRoot } = parseArgs(process.argv.slice(2));
    const failures = checkCleanupRules(repoRoot);

    if (failures.length > 0) {
      printFailures(failures);
      process.exit(1);
    }

    console.log("Cleanup enforcement checks passed.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
