/**
 * Runs the non-mutating publication preparation by default.
 *
 * @param {{runner: (command: string, args: string[]) => Promise<string>, packages?: readonly unknown[], prepare?: () => Promise<readonly unknown[]>, publish?: boolean, waitForVisibility?: (name: string, version: string) => Promise<void>, cleanup?: () => Promise<void>}} options
 * @returns {Promise<{prepared: number, published: string[], skipped: string[]}>}
 */
export async function runSnapshotPublication({
  runner,
  packages = [],
  prepare,
  publish = false,
  waitForVisibility = async () => {},
  cleanup = async () => {},
}) {
  await runner("npm", ["whoami"]);
  const preparedPackages = prepare === undefined ? packages : await prepare();
  const report = { prepared: preparedPackages.length, published: [], skipped: [] };

  try {
    if (!publish) return report;

    for (const entry of orderPackages(preparedPackages)) {
    const tarball = typeof entry === "string" ? entry : entry.tarball;
    const name = typeof entry === "string" ? undefined : entry.name;
    const integrity = typeof entry === "string" ? undefined : entry.integrity;
    if (name !== undefined && integrity !== undefined) {
      const existing = await runner("npm", ["view", name + "@2.0.0-snapshot.2", "dist.integrity"]);
      if (existing.trim()) {
        if (existing.trim() !== integrity) throw new Error("Integrity mismatch for " + name);
        report.skipped.push(name);
        continue;
      }
    }
      const dependencies = typeof entry === "string" ? [] : entry.dependencies || [];
      for (const dependency of dependencies) await waitForVisibility(dependency, "2.0.0-snapshot.2");
      await runner("npm", ["publish", tarball, "--access", "public", "--tag", "snapshot"]);
      report.published.push(name ?? tarball);
    }
    return report;
  } finally {
    await cleanup();
  }
}

function orderPackages(entries) {
  const byName = new Map(entries.filter((entry) => typeof entry !== "string").map((entry) => [entry.name, entry]));
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
 * Executes the non-registry preparation gates and returns the exact tarballs
 * that have been packed, validated, and proven in an external consumer.
 *
 * @param {{runner: (command: string, args: string[]) => Promise<unknown>, checkRoot: () => Promise<void>, checkClean: () => Promise<void>, checkInventory: () => Promise<void>, packAndValidate: () => Promise<readonly unknown[]>, verifyExternalConsumer: (packages: readonly unknown[]) => Promise<void>}} options
 * @returns {Promise<readonly unknown[]>}
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
 * Installs interruption cleanup without coupling the publisher to process.
 *
 * @param {{signals: {on: (signal: string, handler: () => void) => void, off: (signal: string, handler: () => void) => void}, cleanup: () => Promise<void>, exit: (code: number) => void}} options
 * @returns {() => void}
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
