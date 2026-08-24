export const registryUrl = "https://registry.npmjs.org/";

export function compareReleaseVersions(left, right) {
  const parse = (value) => /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-snapshot\.([0-9]+))?$/u.exec(value);
  const leftParts = parse(left);
  const rightParts = parse(right);
  if (leftParts === null || rightParts === null) throw new Error("Invalid release version comparison");
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
      return metadata === undefined ? undefined : { integrity: metadata.dist?.integrity };
    }
    const metadata = await request(encoded);
    return metadata === undefined ? {} : metadata["dist-tags"] ?? {};
  };
}

export async function publishRelease({ release, checksum, registry, publish, poll = async () => {} }) {
  const otherTag = release.tag === "snapshot" ? "latest" : "snapshot";
  const initialTags = new Map();
  const pending = [];
  for (const entry of release.packages) {
    if (checksum(entry.tarball) !== entry.integrity) throw new Error("Tarball changed after preparation for " + entry.name);
    const artifact = await registry("artifact", entry);
    const tags = await registry("tags", entry);
    initialTags.set(entry.name, tags?.[otherTag]);
    if (tags?.[release.tag] && compareReleaseVersions(tags[release.tag], release.version) > 0)
      throw new Error("Selected tag rollback for " + entry.name);
    if (artifact === undefined) pending.push(entry);
    else {
      if (artifact.integrity !== entry.integrity) throw new Error("Integrity mismatch for " + entry.name);
      if (tags?.[release.tag] !== release.version) throw new Error("Selected tag mismatch for " + entry.name);
    }
  }
  if (pending.length === 0) throw new Error("All 18 release artifacts are already published");
  const skipped = release.packages.filter((entry) => !pending.includes(entry)).map(({ name }) => name);
  const published = [];
  for (const entry of pending) {
    if (checksum(entry.tarball) !== entry.integrity) throw new Error("Tarball changed before publication for " + entry.name);
    for (const dependency of entry.dependencies) {
      const dependencyEntry = release.packages.find(({ name }) => name === dependency);
      const visible = dependencyEntry === undefined ? undefined : await registry("artifact", dependencyEntry);
      if (visible?.integrity !== dependencyEntry?.integrity)
        throw new Error("Dependency is not visible: " + dependency);
    }
    await publish(entry, ["--access", "public", "--tag", release.tag, "--registry=" + registryUrl]);
    await poll(entry, release.tag);
    published.push(entry.name);
  }
  for (const entry of release.packages) {
    const tags = await registry("tags", entry);
    if (tags?.[otherTag] !== initialTags.get(entry.name)) throw new Error("Opposite tag moved for " + entry.name);
  }
  return { published, skipped };
}
