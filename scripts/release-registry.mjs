/**
 * Registry metadata needed to verify a release version and selected tag.
 *
 * @typedef {{ versions: Record<string, unknown>, "dist-tags": Record<string, string> }} RegistryRecord
 */

/**
 * Validates one registry response for every package in a release model.
 *
 * @param {{ tag: string, version: string, packages: readonly { name: string }[] }} release expected release
 * @param {ReadonlyMap<string, RegistryRecord>} records registry responses
 * @param {{ complete?: boolean, timeoutMs?: number, deadlineAt?: number, now?: () => number }} options check options
 */
export function assertRegistryReleaseState(release, records, { complete = false } = {}) {
  let published = 0;
  for (const { name } of release.packages) {
    const record = records.get(name);
    if (record === undefined) {
      if (complete) throw new Error("Registry is missing required package: " + name);
      continue;
    }
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
    if ((complete || exists) && (!exists || record["dist-tags"][release.tag] !== release.version))
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
export async function selectUnpublishedPackageNames(
  release,
  fetchResponse,
  { complete = false, timeoutMs = 10_000, deadlineAt, now = Date.now } = {},
) {
  const records = new Map();
  for (const { name } of release.packages) {
    const remainingMs = deadlineAt === undefined ? timeoutMs : deadlineAt - now();
    if (remainingMs <= 0) throw new Error("NPM registry verification deadline was exceeded");
    const requestTimeoutMs = Math.min(timeoutMs, remainingMs);
    const timeoutMessage =
      deadlineAt !== undefined && remainingMs <= timeoutMs
        ? "NPM registry verification deadline was exceeded"
        : "registry read timed out for " + name;
    const controller = new globalThis.AbortController();
    let timeout;
    const timed = new Promise((_, reject) => {
      timeout = globalThis.setTimeout(() => {
        controller.abort();
        reject(new Error(timeoutMessage));
      }, requestTimeoutMs);
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
  return release.packages
    .filter(({ name }) => !(release.version in (records.get(name)?.versions ?? {})))
    .map(({ name }) => name);
}

export const verifyRegistryReleaseState = selectUnpublishedPackageNames;
