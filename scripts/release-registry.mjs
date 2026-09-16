/**
 * Represents public registry metadata for one published package.
 *
 * Registry metadata needed to verify a release version and selected tag.
 *
 * @typedef {{ versions: Record<string, unknown>, "dist-tags": Record<string, string> }} RegistryRecord
 */

/**
 * Rejects malformed registry records, tag mismatches, and a release already published in full.
 *
 * @param release Release model whose package versions and selected tag are checked.
 * @param records Registry packuments indexed by public package name.
 */
export function assertRegistryReleaseState(release, records) {
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
    if (exists && record["dist-tags"][release.tag] !== release.version)
      throw new Error("registry does not expose " + name + " at the selected tag");
  }
  if (published === release.packages.length)
    throw new Error("release version is already fully published");
}

/**
 * Reads public packuments with per-request timeouts and selects packages missing the release version.
 *
 * @param release Release model whose package records are queried.
 * @param fetchResponse Fetch implementation for public npm packuments.
 * @param timeoutMs Maximum duration allowed for each registry request and JSON response.
 * @returns Names whose release version is absent after validating all received records.
 */
export async function selectUnpublishedPackageNames(
  release,
  fetchResponse,
  { timeoutMs = 10_000 } = {},
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
  assertRegistryReleaseState(release, records);
  return release.packages
    .filter(({ name }) => !(release.version in (records.get(name)?.versions ?? {})))
    .map(({ name }) => name);
}

/**
 * Exposes the strict unpublished-package selector used by release CLI preflight.
 */
export const verifyRegistryReleaseState = selectUnpublishedPackageNames;
