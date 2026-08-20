/**
 * Runs the non-mutating publication preparation by default.
 *
 * @param {{runner: (command: string, args: string[]) => Promise<string>, packages: readonly string[], publish?: boolean}} options
 * @returns {Promise<void>}
 */
export async function runSnapshotPublication({ runner, packages, publish = false }) {
  await runner("npm", ["whoami"]);
  const report = { prepared: packages.length, published: [], skipped: [] };

  if (!publish) return report;

  for (const entry of packages) {
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
    await runner("npm", ["publish", tarball, "--access", "public", "--tag", "snapshot"]);
    report.published.push(name ?? tarball);
  }
  return report;
}
