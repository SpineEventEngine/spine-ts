/**
 * Defines dependencies used by snapshot publication.
 *
 * @typedef {object} SnapshotPublicationOptions
 * @property {(command: string, args: string[], options?: object) => Promise<string>} runner
 * @property {readonly unknown[]} [packages]
 * @property {() => Promise<readonly unknown[]>} [prepare]
 * @property {boolean} [publish]
 * @property {(name: string, version: string) => Promise<void>} [waitForVisibility]
 * @property {() => Promise<void>} [cleanup]
 * @property {(entry: unknown) => Promise<string> | string} [integrityFor]
 */

/**
 * Prepares snapshot artifacts and, when enabled, publishes missing archives in dependency order.
 *
 * @param runner Command runner for npm authentication, metadata reads, and publication.
 * @param packages Prepared package entries when no preparation callback is supplied.
 * @param prepare Optional callback that runs all pre-publication gates.
 * @param publish Whether to upload artifacts instead of returning the preparation report.
 * @param waitForVisibility Callback that waits for published internal dependencies.
 * @param cleanup Callback always awaited after preparation or publication finishes.
 * @param integrityFor Callback that calculates or retrieves each prepared artifact integrity.
 * @returns Preparation counts, artifacts, and package names published or skipped.
 */
export async function runSnapshotPublication({
  runner,
  packages = [],
  prepare,
  publish = false,
  waitForVisibility = async () => {},
  cleanup = async () => {},
  integrityFor = (entry) => entry.integrity,
}) {
  try {
    await runner("npm", ["whoami", "--registry=https://registry.npmjs.org/"]);
    const preparedPackages = prepare === undefined ? packages : await prepare();
    const report = {
      prepared: preparedPackages.length,
      artifacts: preparedPackages,
      published: [],
      skipped: [],
    };
    if (!publish) return report;

    for (const entry of orderPackages(preparedPackages)) {
      const tarball = typeof entry === "string" ? entry : entry.tarball;
      const name = typeof entry === "string" ? undefined : entry.name;
      const preparedIntegrity = typeof entry === "string" ? undefined : entry.integrity;
      const integrity = typeof entry === "string" ? undefined : await integrityFor(entry);
      if (
        preparedIntegrity !== undefined &&
        integrity !== undefined &&
        integrity !== preparedIntegrity
      )
        throw new Error("Tarball changed after preparation for " + name);
      if (name !== undefined && integrity !== undefined) {
        let existing = "";
        try {
          existing = await runner(
            "npm",
            [
              "view",
              name + "@2.0.0-snapshot.3",
              "dist.integrity",
              "--registry=https://registry.npmjs.org/",
            ],
            { stdio: "pipe" },
          );
        } catch (error) {
          if (error?.status !== 404) throw error;
        }
        if (existing.trim()) {
          if (existing.trim() !== integrity) throw new Error("Integrity mismatch for " + name);
          report.skipped.push(name);
          continue;
        }
      }
      const dependencies = typeof entry === "string" ? [] : entry.dependencies || [];
      for (const dependency of dependencies)
        await waitForVisibility(dependency, "2.0.0-snapshot.3");
      if (
        name !== undefined &&
        preparedIntegrity !== undefined &&
        (await integrityFor(entry)) !== preparedIntegrity
      )
        throw new Error("Tarball changed after registry comparison for " + name);
      await runner(
        "npm",
        [
          "publish",
          tarball,
          "--access",
          "public",
          "--tag",
          "snapshot",
          "--registry=https://registry.npmjs.org/",
        ],
        {
          stdio: "inherit",
        },
      );
      report.published.push(name ?? tarball);
    }
    return report;
  } finally {
    await cleanup();
  }
}

function orderPackages(entries) {
  const byName = new Map(
    entries.filter((entry) => typeof entry !== "string").map((entry) => [entry.name, entry]),
  );
  const ordered = [];
  const visited = new Set();
  const stringEntries = new Set();
  const visiting = new Set();
  const visit = (entry) => {
    if (typeof entry === "string") {
      if (!stringEntries.has(entry)) ordered.push(entry);
      stringEntries.add(entry);
      return;
    }
    if (entry === undefined || visited.has(entry)) return;
    if (visiting.has(entry)) throw new Error("Internal package dependency cycle: " + entry.name);
    visiting.add(entry);
    for (const dependency of entry.dependencies || []) visit(byName.get(dependency));
    visiting.delete(entry);
    visited.add(entry);
    ordered.push(entry);
  };
  for (const entry of entries) visit(entry);
  return ordered;
}

/**
 * Defines dependencies used while preparing snapshot publication.
 *
 * @typedef {object} PreparationOptions
 * @property {(command: string, args: string[]) => Promise<unknown>} runner
 * @property {() => Promise<void>} checkRoot
 * @property {() => Promise<void>} checkClean
 * @property {() => Promise<void>} checkInventory
 * @property {() => Promise<readonly unknown[]>} packAndValidate
 * @property {(packages: readonly unknown[]) => Promise<void>} verifyExternalConsumer
 */

/**
 * Executes the non-registry preparation gates and returns the exact tarballs
 * that have been packed, validated, and proven in an external consumer.
 *
 * @param runner Command runner for lockfile installation and release verification.
 * @param checkRoot Callback that confirms the repository is the expected root.
 * @param checkClean Callback that rejects a dirty checkout.
 * @param checkInventory Callback that validates the public package inventory.
 * @param packAndValidate Callback that packs and validates exact publication tarballs.
 * @param verifyExternalConsumer Callback that installs the tarballs outside the workspace.
 * @returns Packed artifact entries that passed all preparation gates.
 */
export async function prepareSnapshotPublication({
  runner,
  checkRoot,
  checkClean,
  checkInventory,
  packAndValidate,
  verifyExternalConsumer,
}) {
  await checkRoot();
  await checkClean();
  await checkInventory();
  await runner("pnpm", ["install", "--frozen-lockfile"]);
  await runner("pnpm", ["verify:release"]);
  const packages = await packAndValidate();
  await verifyExternalConsumer(packages);
  return packages;
}

/**
 * Defines process-signal registration operations.
 *
 * @typedef {object} SignalSource
 * @property {(signal: string, handler: () => void) => void} on
 * @property {(signal: string, handler: () => void) => void} off
 */

/**
 * Defines cleanup handler dependencies for snapshot publication.
 *
 * @typedef {object} CleanupHandlerOptions
 * @property {SignalSource} signals
 * @property {() => Promise<void>} cleanup
 * @property {(code: number) => void} exit
 */

/**
 * Registers SIGINT and SIGTERM handlers that clean temporary artifacts before exiting.
 *
 * @param signals Signal subscription source, injectable instead of the global process.
 * @param cleanup Asynchronous cleanup run before a signal-specific exit code.
 * @param exit Exit callback invoked with 130 for SIGINT or 143 for SIGTERM.
 * @returns A function that unregisters both installed signal handlers.
 */
export function installCleanupHandlers({ signals, cleanup, exit }) {
  const handlers = new Map();
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ]) {
    const handler = () => {
      void cleanup().finally(() => exit(code));
    };
    handlers.set(signal, handler);
    signals.on(signal, handler);
  }
  return () => {
    for (const [signal, handler] of handlers) signals.off(signal, handler);
  };
}

/**
 * Waits for npm to expose a package version, retrying only explicit not-found responses.
 *
 * @param runner Command runner for `npm view` queries.
 * @param sleep Delay callback used between 404 responses.
 * @param name Published package name to query.
 * @param version Exact version that must become visible.
 * @param attempts Maximum registry reads before timing out.
 * @returns A promise that resolves once npm reports the exact version.
 */
export async function waitForRegistryVisibility({ runner, sleep, name, version, attempts = 6 }) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const visible = await runner(
        "npm",
        ["view", name + "@" + version, "version", "--registry=https://registry.npmjs.org/"],
        { stdio: "pipe" },
      );
      if (visible.trim() === version) return;
      throw new Error("Registry returned an unexpected version for " + name);
    } catch (error) {
      if (error?.status !== 404) throw error;
      if (attempt + 1 === attempts)
        throw new Error("Timed out waiting for " + name + "@" + version);
      await sleep(1000 * (attempt + 1));
    }
  }
}
