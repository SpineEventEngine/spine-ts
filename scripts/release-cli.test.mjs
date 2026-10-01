import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeRelease, main, npmEnvironment, prepareRelease } from "./release-cli.mjs";
import { expectedReleaseModel, readReleaseManifests } from "./release-policy.mjs";

const sourceSha = "a".repeat(40);
const expected = {
  tag: "snapshot",
  version: "2.0.0-snapshot.20",
  packages: [{ name: "@spine-event-engine/proto", dependencies: [] }],
};
const packed = {
  name: expected.packages[0].name,
  version: expected.version,
  tarball: "/tmp/spine-event-engine-proto-2.0.0-snapshot.20.tgz",
  integrity: "sha512-YQ==",
  dependencies: [],
};

describe("release CLI", () => {
  it("starts pinned npm with distinct empty configuration files", () => {
    const directory = mkdtempSync(join(tmpdir(), "spine-npm-config-test-"));
    try {
      const env = npmEnvironment(directory);
      expect(env.NPM_CONFIG_USERCONFIG).not.toBe(env.NPM_CONFIG_GLOBALCONFIG);
      const result = spawnSync("npm", ["config", "get", "registry"], { encoding: "utf8", env });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe("https://registry.npmjs.org/");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
  it("persists one manifest only after archive packing and consumer proof", () => {
    const directory = mkdtempSync(join(tmpdir(), "spine-preparation-test-"));
    rmSync(directory, { recursive: true });
    const calls = [];
    try {
      const manifest = prepareRelease({
        destination: directory,
        expected,
        sourceSha,
        pack: () => {
          calls.push("pack");
          return [packed];
        },
        prove: () => {
          calls.push("prove");
        },
        persist: (_path, value) => {
          calls.push("persist");
          expect(value.sourceSha).toBe(sourceSha);
        },
        load: () => {
          calls.push("load");
        },
      });
      expect(calls).toEqual(["pack", "prove", "persist", "load"]);
      expect(manifest.packages[0].tarball).toBe("spine-event-engine-proto-2.0.0-snapshot.20.tgz");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("reopens a saved check archive through the publication validation handoff", () => {
    const directory = mkdtempSync(join(tmpdir(), "spine-check-test-"));
    rmSync(directory, { recursive: true });
    const calls = [];
    prepareRelease({
      destination: directory,
      check: true,
      expected,
      sourceSha,
      pack: () => {
        calls.push("pack");
        return [packed];
      },
      prove: () => calls.push("prove"),
      persist: (path, value) => {
        calls.push("persist");
        writeFileSync(path, JSON.stringify(value));
      },
      load: (path, policy, sha) => {
        calls.push("load");
        expect(policy).toBe(expected);
        expect(sha).toBe(sourceSha);
        expect(
          JSON.parse(readFileSync(join(path, "release-manifest.json"), "utf8")).sourceSha,
        ).toBe(sourceSha);
      },
    });
    expect(calls).toEqual(["pack", "prove", "persist", "load"]);
    expect(existsSync(directory)).toBe(false);
  });

  it("rejects an incomplete saved release before publication through the default loader", () => {
    const directory = mkdtempSync(join(tmpdir(), "spine-load-test-"));
    rmSync(directory, { recursive: true });
    expect(() =>
      prepareRelease({
        destination: directory,
        expected,
        sourceSha,
        pack: () => [packed],
        prove: () => {},
        persist: (path, value) => writeFileSync(path, JSON.stringify(value)),
      }),
    ).toThrow("Invalid release manifest inventory");
    expect(existsSync(directory)).toBe(false);
  });

  it("removes incomplete preparation and never persists after failed proof", () => {
    const directory = mkdtempSync(join(tmpdir(), "spine-preparation-test-"));
    rmSync(directory, { recursive: true });
    expect(() =>
      prepareRelease({
        destination: directory,
        expected,
        sourceSha,
        pack: () => [packed],
        prove: () => {
          throw new Error("consumer failed");
        },
        persist: () => {
          throw new Error("unexpected persistence");
        },
      }),
    ).toThrow("consumer failed");
    expect(existsSync(directory)).toBe(false);
  });

  it("rejects a mismatched inspected version before persistence", () => {
    const directory = mkdtempSync(join(tmpdir(), "spine-version-test-"));
    rmSync(directory, { recursive: true });
    let persisted = false;
    expect(() =>
      prepareRelease({
        destination: directory,
        expected,
        sourceSha,
        pack: () => [{ ...packed, version: "2.0.0-snapshot.18" }],
        prove: () => {},
        persist: () => {
          persisted = true;
        },
      }),
    ).toThrow("Packed artifact version");
    expect(persisted).toBe(false);
    expect(existsSync(directory)).toBe(false);
  });

  it("registers cleanup before persistent output creation and preserves existing output", () => {
    const directory = mkdtempSync(join(tmpdir(), "spine-create-signal-"));
    rmSync(directory, { recursive: true });
    const handlers = new Map();
    expect(() =>
      prepareRelease({
        destination: directory,
        expected,
        sourceSha,
        registerSignal: (name, handler) => {
          handlers.set(name, handler);
          return () => handlers.delete(name);
        },
        exit: () => {
          throw new Error("interrupted during creation");
        },
        createDirectory: (path) => {
          expect(handlers.has("SIGINT")).toBe(true);
          mkdirSync(path);
          handlers.get("SIGINT")();
        },
        pack: () => [],
        prove: () => {},
        persist: () => {},
      }),
    ).toThrow("interrupted during creation");
    expect(existsSync(directory)).toBe(false);
    mkdirSync(directory);
    expect(() => prepareRelease({ destination: directory, expected, sourceSha })).toThrow(
      "already exists",
    );
    expect(existsSync(directory)).toBe(true);
    rmSync(directory, { recursive: true });
  });

  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ])("cleans preparation on %s", (signal, code) => {
    const directory = mkdtempSync(join(tmpdir(), "spine-preparation-signal-"));
    rmSync(directory, { recursive: true });
    const handlers = new Map();
    expect(() =>
      prepareRelease({
        destination: directory,
        expected,
        sourceSha,
        registerSignal: (name, handler) => {
          handlers.set(name, handler);
          return () => handlers.delete(name);
        },
        exit: (status) => {
          expect(status).toBe(code);
          throw new Error("interrupted");
        },
        pack: () => {
          handlers.get(signal)();
          return [packed];
        },
        prove: () => {},
        persist: () => {},
      }),
    ).toThrow("interrupted");
    expect(existsSync(directory)).toBe(false);
    expect(handlers.size).toBe(0);
  });

  it("routes publication and read-only verification through separate commands", async () => {
    const calls = [];
    const dependencies = {
      expected,
      execute: async (options) => {
        calls.push(options);
      },
    };
    await main({
      argv: ["node", "cli", "publish", "--input", "release", "--report", "report.json"],
      dependencies,
    });
    await main({
      argv: ["node", "cli", "verify-registry", "--input", "release", "--report", "report.json"],
      dependencies,
    });
    expect(calls.map(({ verifyOnly }) => verifyOnly)).toEqual([false, true]);
    await expect(
      main({ argv: ["node", "cli", "prepare-publication-workspace"], dependencies }),
    ).rejects.toThrow("Supported commands");
  });

  it("verifies an already-published release without invoking npm", async () => {
    const release = {
      ...expected,
      sourceSha,
      packages: [{ ...packed, version: expected.version }],
    };
    const statement = {
      predicateType: "https://slsa.dev/provenance/v1",
      subject: [
        {
          name: `pkg:npm/%40spine-event-engine/proto@${expected.version}`,
          digest: { sha512: "61" },
        },
      ],
      predicate: {
        buildDefinition: {
          externalParameters: {
            workflow: {
              repository: "https://github.com/SpineEventEngine/spine-ts",
              path: ".github/workflows/publish.yml",
              ref: "refs/heads/master",
            },
          },
          resolvedDependencies: [
            {
              uri: "git+https://github.com/SpineEventEngine/spine-ts@refs/heads/master",
              digest: { gitCommit: sourceSha },
            },
          ],
        },
      },
    };
    const registry = async (kind) =>
      kind === "tags"
        ? { snapshot: expected.version }
        : kind === "artifact"
          ? {
              name: packed.name,
              version: expected.version,
              dist: {
                integrity: packed.integrity,
                attestations: {
                  url: `https://registry.npmjs.org/-/npm/v1/attestations/@spine-event-engine%2fproto@${expected.version}`,
                },
              },
            }
          : {
              attestations: [
                {
                  bundle: {
                    mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
                    dsseEnvelope: {
                      payloadType: "application/vnd.in-toto+json",
                      payload: Buffer.from(JSON.stringify(statement)).toString("base64"),
                      signatures: [{ sig: "c2ln", keyid: "" }],
                    },
                    verificationMaterial: {
                      certificate: { rawBytes: "Y2VydA==" },
                      tlogEntries: [
                        {
                          logId: { keyId: "a2V5" },
                          kindVersion: { kind: "dsse", version: "0.0.1" },
                          canonicalizedBody: "Ym9keQ==",
                          inclusionPromise: { signedEntryTimestamp: "c2V0" },
                          inclusionProof: {
                            rootHash: "cm9vdA==",
                            hashes: [],
                            checkpoint: { envelope: "checkpoint" },
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            };
    const report = await executeRelease({
      input: "/unused",
      reportPath: "/unused-report",
      verifyOnly: true,
      dependencies: {
        expected,
        load: () => release,
        registry,
        save: async () => {},
        invoke: async () => {
          throw new Error("unexpected npm publish");
        },
      },
    });
    expect(report.packages[0].status).toBe("already present");
  });

  it("retains a complete 19-package report when the first npm upload fails", async () => {
    const root = new URL("..", import.meta.url).pathname;
    const model = expectedReleaseModel(readReleaseManifests(root));
    const release = {
      ...model,
      sourceSha,
      packages: model.packages.map((entry) => ({
        ...entry,
        version: model.version,
        tarball: entry.name.split("/")[1] + ".tgz",
        integrity: "sha512-YQ==",
      })),
    };
    let saved;
    let tick = 0;
    await expect(
      executeRelease({
        input: "/unused",
        reportPath: "/unused-report",
        dependencies: {
          expected: model,
          load: () => release,
          save: async (value) => {
            saved = globalThis.structuredClone(value);
          },
          registry: async (kind) => (kind === "tags" ? {} : undefined),
          confirmation: { now: () => tick++, sleep: async () => {}, windowMs: 4 },
          invoke: async () => ({ status: 1, stdout: JSON.stringify({ error: { code: "E401" } }) }),
        },
      }),
    ).rejects.toThrow("Publication confirmation remains unconfirmed");
    expect(saved.packages).toHaveLength(19);
    expect(saved.packages[0].status).toBe("unconfirmed");
    expect(saved.packages.slice(1).every(({ status }) => status === "not attempted")).toBe(true);
  });

  it("confirms an uncertain npm result after delayed registry visibility without resending", async () => {
    const release = { ...expected, sourceSha, packages: [packed] };
    let reads = 0;
    let sends = 0;
    let time = 0;
    let waits = 0;
    const report = await executeRelease({
      input: "/unused",
      reportPath: "/unused-report",
      dependencies: {
        expected,
        load: () => release,
        save: async () => {},
        confirmation: {
          now: () => time,
          sleep: async (ms) => {
            time += ms;
            waits++;
          },
          windowMs: 4_000,
        },
        registry: async (kind, entry) => {
          if (kind === "artifact") {
            reads++;
            if (reads <= 3) return undefined;
            return {
              name: entry.name,
              version: expected.version,
              dist: {
                integrity: entry.integrity,
                attestations: {
                  url: `https://registry.npmjs.org/-/npm/v1/attestations/@spine-event-engine%2fproto@${expected.version}`,
                },
              },
            };
          }
          if (kind === "tags") return reads >= 2 ? { snapshot: expected.version } : {};
          return {
            attestations: [
              {
                bundle: {
                  mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
                  dsseEnvelope: {
                    payloadType: "application/vnd.in-toto+json",
                    payload: Buffer.from(
                      JSON.stringify({
                        predicateType: "https://slsa.dev/provenance/v1",
                        subject: [
                          {
                            name: `pkg:npm/%40spine-event-engine/proto@${expected.version}`,
                            digest: { sha512: "61" },
                          },
                        ],
                        predicate: {
                          buildDefinition: {
                            externalParameters: {
                              workflow: {
                                repository: "https://github.com/SpineEventEngine/spine-ts",
                                path: ".github/workflows/publish.yml",
                                ref: "refs/heads/master",
                              },
                            },
                            resolvedDependencies: [
                              {
                                uri: "git+https://github.com/SpineEventEngine/spine-ts@refs/heads/master",
                                digest: { gitCommit: sourceSha },
                              },
                            ],
                          },
                        },
                      }),
                    ).toString("base64"),
                    signatures: [{ sig: "c2ln", keyid: "" }],
                  },
                  verificationMaterial: {
                    certificate: { rawBytes: "Y2VydA==" },
                    tlogEntries: [
                      {
                        logId: { keyId: "a2V5" },
                        kindVersion: { kind: "dsse", version: "0.0.1" },
                        canonicalizedBody: "Ym9keQ==",
                        inclusionPromise: { signedEntryTimestamp: "c2V0" },
                        inclusionProof: {
                          rootHash: "cm9vdA==",
                          hashes: [],
                          checkpoint: { envelope: "checkpoint" },
                        },
                      },
                    ],
                  },
                },
              },
            ],
          };
        },
        invoke: async () => {
          sends++;
          return { status: 1, stdout: JSON.stringify({ error: { code: "E409" } }) };
        },
      },
    });
    expect(sends).toBe(1);
    expect(reads).toBe(4);
    expect(waits).toBe(1);
    expect(report.packages[0].status).toBe("published");
  });
});
