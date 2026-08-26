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
      Array.isArray(record) ||
      record.versions === null ||
      typeof record.versions !== "object" ||
      Array.isArray(record.versions) ||
      record["dist-tags"] === null ||
      typeof record["dist-tags"] !== "object" ||
      Array.isArray(record["dist-tags"])
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
export async function verifyRegistryReleaseState(
  release,
  fetchResponse,
  { complete = false, timeoutMs = 10_000 } = {},
) {
  const records = new Map();
  for (const { name } of release.packages) {
    const controller = new globalThis.AbortController();
    let timeout;
    const timed = new Promise((_, reject) => {
      timeout = globalThis.setTimeout(() => {
        controller.abort();
        reject(new Error("registry read timed out for " + name));
      }, timeoutMs);
    });
    try {
      const response = await Promise.race([
        fetchResponse("https://registry.npmjs.org/" + encodeURIComponent(name), {
          signal: controller.signal,
        }),
        timed,
      ]);
      if (response.status === 404) continue;
      if (!response.ok) throw new Error("ambiguous registry response for " + name);
      records.set(name, await Promise.race([response.json(), timed]));
    } finally {
      globalThis.clearTimeout(timeout);
      controller.abort();
    }
  }
  assertRegistryReleaseState(release, records, { complete });
}
