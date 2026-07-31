import { spawnSync } from "node:child_process";

export function parseTaskVerificationArgs(args) {
  const values = args[0] === "--" ? args.slice(1) : args;
  if (values.length === 1 && values[0] === "--no-tests") return { noTests: true };
  if (values[0] === "--no-tests") throw new Error("--no-tests must be the only argument.");
  if (values[0] !== "--coverage" && values[0] !== "--no-coverage") {
    throw new Error(
      "verify:task requires --coverage or --no-coverage followed by focused test paths, or --no-tests.",
    );
  }
  const sourceIndex = values.indexOf("--source");
  const paths = values.slice(1, sourceIndex === -1 ? undefined : sourceIndex);
  if (paths.length === 0 || paths.some((path) => path.startsWith("--"))) {
    throw new Error("verify:task requires at least one focused test path.");
  }
  const coverage = values[0] === "--coverage";
  const sources = sourceIndex === -1 ? [] : values.slice(sourceIndex + 1);
  if (coverage && sources.length === 0) {
    throw new Error("verify:task --coverage requires --source followed by changed source paths.");
  }
  if (sources.some((path) => path.startsWith("--"))) {
    throw new Error("verify:task --source accepts only source paths.");
  }
  return { coverage, paths, ...(coverage ? { sources } : {}) };
}

export function vitestArgs(choice) {
  return [
    "exec",
    "vitest",
    "run",
    ...(choice.coverage
      ? ["--coverage", ...choice.sources.map((source) => `--coverage.include=${source}`)]
      : []),
    ...choice.paths,
  ];
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error !== undefined) throw result.error;
  if (result.signal !== null || result.status !== 0) process.exit(result.status ?? 1);
}

function main() {
  const choice = parseTaskVerificationArgs(process.argv.slice(2));
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  run(pnpm, ["verify:generated-gates"]);
  if (choice.noTests) return;
  run(pnpm, vitestArgs(choice));
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
