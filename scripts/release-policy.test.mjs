import { describe, expect, it } from "vitest";

import {
  classifyReleaseVersion,
  readReleaseManifests,
  releaseManifestPaths,
  validateReleasePolicy,
} from "./release-policy.mjs";

describe("release policy", () => {
  it("maps exact snapshot and stable versions to their only supported channels", () => {
    expect(classifyReleaseVersion("2.0.0-snapshot.4")).toEqual({
      tag: "snapshot",
      version: "2.0.0-snapshot.4",
    });
    expect(classifyReleaseVersion("2.0.0")).toEqual({ tag: "latest", version: "2.0.0" });
  });

  it("rejects unsupported prereleases before any publication work can begin", () => {
    expect(() => classifyReleaseVersion("2.0.0-rc.1")).toThrow("Unsupported release version");
    expect(() => classifyReleaseVersion("not-a-version")).toThrow("Unsupported release version");
  });

  it("keeps the complete workspace and public-package inventories explicit", () => {
    expect(releaseManifestPaths).toHaveLength(26);
    expect(releaseManifestPaths.filter((path) => path.startsWith("packages/"))).toHaveLength(18);
  });

  it("requires a common version, exact public inventory, tag-free metadata, and concrete pins", () => {
    const manifests = releaseManifestPaths.map((path) => ({
      path,
      manifest: {
        name: path === "package.json" ? "spine-ts" : "@spine-event-engine/" + path.split("/")[1],
        version: "2.0.0-snapshot.4",
        private: !path.startsWith("packages/"),
        ...(path.startsWith("packages/")
          ? {
              publishConfig: {
                access: "public",
                registry: "https://registry.npmjs.org/",
              },
            }
          : {}),
      },
    }));
    expect(validateReleasePolicy(manifests)).toEqual({
      tag: "snapshot",
      version: "2.0.0-snapshot.4",
    });
    manifests[1].manifest.version = "2.0.0";
    expect(() => validateReleasePolicy(manifests)).toThrow("must use the root version");
  });

  it("rejects a static manifest tag because the version classifier is authoritative", () => {
    const manifests = releaseManifestPaths.map((path) => ({
      path,
      manifest: {
        name: path === "package.json" ? "spine-ts" : "@spine-event-engine/" + path.split("/")[1],
        version: "2.0.0-snapshot.4",
        private: !path.startsWith("packages/"),
        ...(path.startsWith("packages/")
          ? {
              publishConfig: {
                access: "public",
                registry: "https://registry.npmjs.org/",
                tag: "snapshot",
              },
            }
          : {}),
      },
    }));
    expect(() => validateReleasePolicy(manifests)).toThrow("must not define publishConfig.tag");
  });

  it("fails closed for each repository policy boundary", () => {
    const entries = readReleaseManifests(new URL("..", import.meta.url).pathname);
    expect(() => validateReleasePolicy(entries.slice(1))).toThrow("26-path inventory");
    const wrongPath = globalThis.structuredClone(entries);
    wrongPath[1].path = "packages/not-auth/package.json";
    expect(() => validateReleasePolicy(wrongPath)).toThrow("26-path inventory");
    const wrongBoundary = globalThis.structuredClone(entries);
    wrongBoundary[1].manifest.name = "@other/auth";
    expect(() => validateReleasePolicy(wrongBoundary)).toThrow("public/private boundary");
    const wrongConfig = globalThis.structuredClone(entries);
    wrongConfig[1].manifest.publishConfig.access = "restricted";
    expect(() => validateReleasePolicy(wrongConfig)).toThrow("invalid publishConfig");
    const wrongPin = globalThis.structuredClone(entries);
    wrongPin[1].manifest.dependencies = { "@spine-event-engine/core": "1.0.0" };
    expect(() => validateReleasePolicy(wrongPin)).toThrow("must use 2.0.0-snapshot.5");
  });
});
