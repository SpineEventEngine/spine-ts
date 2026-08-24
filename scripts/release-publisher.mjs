export const registryUrl = "https://registry.npmjs.org/";

export function compareReleaseVersions(left, right) {
  const parse = (value) => /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-snapshot\.([0-9]+))?$/u.exec(value);
  const leftParts = parse(left);
  const rightParts = parse(right);
  if (leftParts === null || rightParts === null)
    throw new Error("Invalid release version comparison");
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(leftParts[index]) - Number(rightParts[index]);
    if (difference) return difference;
  }
  if (leftParts[4] === undefined) return rightParts[4] === undefined ? 0 : 1;
  if (rightParts[4] === undefined) return -1;
  return Number(leftParts[4]) - Number(rightParts[4]);
}

export function createPublicRegistry({ fetch }) {
  const request = async (path) => {
    const response = await fetch(registryUrl + path, { headers: { accept: "application/json" } });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error("Registry request failed: " + response.status);
    return response.json();
  };
  return async (kind, entry) => {
    const encoded = encodeURIComponent(entry.name);
    if (kind === "artifact") {
      const metadata = await request(encoded + "/" + entry.version);
      if (metadata === undefined) return undefined;
      if (
        typeof metadata?.dist?.integrity !== "string" ||
        !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(metadata.dist.integrity)
      )
        throw new Error("Registry metadata is missing a valid integrity");
      return { integrity: metadata.dist.integrity };
    }
    const metadata = await request(encoded);
    if (metadata === undefined) return {};
    const tags = metadata["dist-tags"];
    if (tags === null || typeof tags !== "object" || Array.isArray(tags))
      throw new Error("Registry metadata has invalid dist-tags");
    return tags;
  };
}

export async function waitForRegistryVisibility({ registry, entry, tag, sleep, attempts = 6 }) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const artifact = await registry("artifact", entry);
    const tags = await registry("tags", entry);
    if (artifact?.integrity === entry.integrity && tags[tag] === entry.version) return;
    if (attempt + 1 < attempts) await sleep(1000 * (attempt + 1));
  }
  throw new Error("Timed out waiting for registry visibility: " + entry.name + "@" + entry.version);
}

export async function publishRelease({ release, checksum, registry, publish, poll }) {
  if (typeof poll !== "function") throw new Error("A registry visibility poller is required");
  const otherTag = release.tag === "snapshot" ? "latest" : "snapshot";
  const initialTags = new Map();
  const pending = [];
  for (const entry of release.packages) {
    if (checksum(entry.tarball) !== entry.integrity)
      throw new Error("Tarball changed after preparation for " + entry.name);
    const artifact = await registry("artifact", entry);
    const tags = await registry("tags", entry);
    initialTags.set(entry.name, tags?.[otherTag]);
    if (tags?.[release.tag] && compareReleaseVersions(tags[release.tag], release.version) > 0)
      throw new Error("Selected tag rollback for " + entry.name);
    if (artifact === undefined) pending.push(entry);
    else {
      if (artifact.integrity !== entry.integrity)
        throw new Error("Integrity mismatch for " + entry.name);
      if (tags?.[release.tag] !== release.version)
        throw new Error("Selected tag mismatch for " + entry.name);
    }
  }
  if (pending.length === 0) throw new Error("All release artifacts are already published");
  const skipped = release.packages
    .filter((entry) => !pending.includes(entry))
    .map(({ name }) => name);
  const published = [];
  const byName = new Map(pending.map((entry) => [entry.name, entry]));
  const ordered = [];
  const visited = new Set();
  const visit = (entry) => {
    if (visited.has(entry.name)) return;
    visited.add(entry.name);
    for (const dependency of entry.dependencies) {
      const dependencyEntry = byName.get(dependency);
      if (dependencyEntry !== undefined) visit(dependencyEntry);
    }
    ordered.push(entry);
  };
  for (const entry of pending) visit(entry);
  for (const entry of ordered) {
    if (checksum(entry.tarball) !== entry.integrity)
      throw new Error("Tarball changed before publication for " + entry.name);
    for (const dependency of entry.dependencies) {
      const dependencyEntry = release.packages.find(({ name }) => name === dependency);
      const visible =
        dependencyEntry === undefined ? undefined : await registry("artifact", dependencyEntry);
      if (visible?.integrity !== dependencyEntry?.integrity)
        throw new Error("Dependency is not visible: " + dependency);
    }
    await publish(entry, ["--access", "public", "--tag", release.tag, "--registry=" + registryUrl]);
    await poll(entry, release.tag);
    published.push(entry.name);
  }
  for (const entry of release.packages) {
    const tags = await registry("tags", entry);
    if (tags?.[otherTag] !== initialTags.get(entry.name))
      throw new Error("Opposite tag moved for " + entry.name);
  }
  return { published, skipped };
}
