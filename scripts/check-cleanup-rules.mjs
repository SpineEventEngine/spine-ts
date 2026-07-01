import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const maxLineLength = 120;
const maxSemanticComponents = 4;
const generatedNamePatterns = [/^file_spine_/, /^generated[A-Z]/, /^[A-Z0-9_]+$/];
const inheritedSemanticNameExceptions = new Set([
  "BoundedContextRepositoryRegistrationErrorCode",
  "BoundedContextRepositoryRegistrationOperation",
  "BoundedContextRepositoryRegistrationConflictErrorDetails",
  "BoundedContextRepositorySnapshotErrorDetails",
  "BoundedContextRepositoryRegistrationErrorDetails",
  "BoundedContextRepositoryRegistrationError",
  "cloneRepositoryFieldMetadataList",
  "freezeRepositoryRegistrationErrorDetails",
  "validateRepositoryFieldMetadataList",
  "readCanonicalRepositorySemanticTags",
  "validateCanonicalRepositorySemanticTagList",
  "assigneesByCommandFullTypeName",
  "registeredCommandMessageFullTypeNames",
  "isAuthenticCommandRegistrationReadiness",
  "EntityTransactionCommittedVersionMetadata",
  "EntityTransactionDraftStateReason",
  "EntityTransactionDraftStateError",
  "EntityStateTransitionValidationRequest",
  "EntityStateTransitionValidationResult",
  "createSetOnceTransitionRule",
  "fieldValueShapeIsSafe",
  "fieldValueShapeIsSafeUnchecked",
  "readSafeUint8ArrayBytes",
  "hasOnlyDenseIndexedDataProperties",
  "isUnsupportedSetOnceField",
  "TransactionalEntityScopeErrorReason",
  "NonPlainEntityVersionMetadata",
  "PlainEntityVersionMetadataAtDepth",
  "nonPlainVersionMetadataError",
  "subscribersByEventFullTypeName",
  "reactorsByEventFullTypeName",
  "applicationsByEventFullTypeName",
  "registeredEventMessageFullTypeNames",
  "isAuthenticEventRegistrationReadiness",
  "HandlerMetadataRegistryErrorCode",
  "entityStateFullTypeName",
  "findEntityHandlersByState",
  "findHandlersByMessageFullTypeName",
  "ServerRuntimeStateErrorCode",
  "createServerRuntimeRoutingPlan",
  "DeferredServerRuntimeRoutingSeam",
  "ServerRuntimeRoutingPlanInput",
  "ServerRuntimeRouteMessageDescriptor",
  "ServerRuntimeRouteTransportReference",
  "eventReceiverGroupToHandlerKind",
  "createCommandRuntimeRoutingPlan",
  "createEventRuntimeRoutingPlan",
  "topicByEventFullTypeName",
  "createEventWorkersById",
  "expectedMessageFullTypeName",
  "createInMemoryStorageAdapter",
  "InMemoryAggregateEventStore",
  "InMemoryTenantIndexStore",
  "InMemoryDiagnosticRecordStore",
  "transportDeliveryFailureKindSet",
  "TransportDeliveryFailureDetailValue",
  "TransportDeliveryFailureClassificationInput",
  "TransportDeliveryResultInputBase",
  "normalizeTransportDeliveryFailureKind",
  "isSafeFailureDetailKey",
  "isTransportDeliveryFailureDetailValue",
  "ZeroMqAdapterConfigInput",
  "createZeroMqAdapterConfig",
  "readRepositoryEntityTypeOption",
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
    if (!/^(packages\/[^/]+\/src\/|scripts\/)/.test(file)) {
      return false;
    }

    if (!/\.(ts|mjs)$/.test(file)) {
      return false;
    }

    return (
      !file.includes("/generated/") && !file.endsWith(".test.ts") && !file.endsWith(".test.mjs")
    );
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

function semanticComponents(name) {
  const trimmed = name.replace(/^_+/, "");

  if (
    trimmed.length === 0 ||
    generatedNamePatterns.some((pattern) => pattern.test(trimmed)) ||
    inheritedSemanticNameExceptions.has(trimmed)
  ) {
    return [];
  }

  return trimmed
    .split("_")
    .flatMap((part) => part.match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])/g) ?? [])
    .filter(Boolean);
}

function hasCallbackType(node) {
  if (node.type === undefined) {
    return false;
  }

  return node.type.getText().endsWith("Callback");
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
        semanticViolations.push(
          `${file}:${position.line + 1} ${name} (${components.length} components)`,
        );
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
