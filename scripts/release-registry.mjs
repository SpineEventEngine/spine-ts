/**
 * Validates one registry response for every package in a release model.
 *
 * @param {{ tag: string, version: string, packages: readonly { name: string }[] }} release expected release
 * @param {ReadonlyMap<string, { versions: Record<string, unknown>, "dist-tags": Record<string, string> }>} records registry responses
 * @param {{ complete?: boolean }} options post-publication check options
 */
export function assertRegistryReleaseState(release, records, { complete = false } = {}) {
  let published = 0;
  for (const { name } of release.packages) {
    const record = records.get(name);
    if (record === undefined) continue;
    if (
      record === null ||
      typeof record !== "object" ||
      record.versions === null ||
      typeof record.versions !== "object" ||
      record["dist-tags"] === null ||
      typeof record["dist-tags"] !== "object"
    )
      throw new Error("ambiguous registry response for " + name);
    const exists = release.version in record.versions;
    if (exists) published++;
    if (complete && (!exists || record["dist-tags"][release.tag] !== release.version))
      throw new Error("registry does not expose " + name + " at the selected tag");
  }
  if (!complete && published === release.packages.length)
    throw new Error("release version is already fully published");
}

/**
 * Reads one public-registry packument for each package without mutation.
 *
 * @param {{ tag: string, version: string, packages: readonly { name: string }[] }} release expected release
 * @param {(url: string) => Promise<Response>} fetchResponse fetch implementation
 * @param {{ complete?: boolean }} options post-publication check options
 */
export async function verifyRegistryReleaseState(release, fetchResponse, options) {
  const records = new Map();
  for (const { name } of release.packages) {
    const response = await fetchResponse("https://registry.npmjs.org/" + encodeURIComponent(name));
    if (response.status === 404) continue;
    if (!response.ok) throw new Error("ambiguous registry response for " + name);
    records.set(name, await response.json());
  }
  assertRegistryReleaseState(release, records, options);
}
