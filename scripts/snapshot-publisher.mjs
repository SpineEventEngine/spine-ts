/**
 * Runs the non-mutating publication preparation by default.
 *
 * @param {{runner: (command: string, args: string[]) => Promise<string>, packages: readonly string[], publish?: boolean}} options
 * @returns {Promise<void>}
 */
export async function runSnapshotPublication({ runner, packages, publish = false }) {
  await runner("npm", ["whoami"]);

  if (!publish) return;

  for (const tarball of packages) {
    await runner("npm", ["publish", tarball, "--access", "public", "--tag", "snapshot"]);
  }
}
