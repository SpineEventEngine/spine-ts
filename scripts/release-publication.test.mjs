import { afterEach, describe, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";

import {
  confirmPrepared,
  createPublicationReport,
  createPublicRegistry,
  hasExpectedProvenance,
  isRekorConflict,
  npmPublishArgs,
  publishPrepared,
  validatePriorReport,
} from "./release-publication.mjs";
import { expectedReleaseModel, readReleaseManifests } from "./release-policy.mjs";
import { TemporaryRegistryError } from "./release-get.mjs";

const recordId = "108e9186e8c5677a245de144eb51ce7c25da7fd499317cef7acfecf9a480e3b2d7dc97903b374234";
const conflictText = `an equivalent entry already exists in the transparency log with UUID ${recordId}`;
const conflict = {
  error: {
    code: "TLOG_CREATE_ENTRY_ERROR",
    summary: `error creating tlog entry - (409) ${conflictText}`,
    detail: `(409) ${conflictText}`,
  },
};
const savedConflict = {
  result: "pre-upload-conflict",
  diagnostics: { exitCode: 1, ...conflict.error },
};

afterEach(() => vi.unstubAllEnvs());

describe("npm publication recovery", () => {
  it("accepts only the complete pinned npm conflict error", () => {
    expect(isRekorConflict(JSON.stringify(conflict))).toBe(true);
    for (const field of ["code", "summary", "detail"]) {
      const changed = globalThis.structuredClone(conflict);
      changed.error[field] = field === "code" ? "E409" : "(409) Conflict";
      expect(isRekorConflict(JSON.stringify(changed))).toBe(false);
    }
    expect(isRekorConflict("TLOG_CREATE_ENTRY_ERROR (409)")).toBe(false);
    const mismatched = globalThis.structuredClone(conflict);
    mismatched.error.detail = mismatched.error.detail.replace(recordId, "a".repeat(80));
    expect(isRekorConflict(JSON.stringify(mismatched))).toBe(false);
    const suffix = globalThis.structuredClone(conflict);
    suffix.error.summary += " extra";
    expect(isRekorConflict(JSON.stringify(suffix))).toBe(false);
  });

  it("uses the exact npm archive publication arguments", () => {
    expect(npmPublishArgs("core.tgz", "snapshot")).toEqual([
      "publish",
      "core.tgz",
      "--provenance",
      "--ignore-scripts",
      "--access",
      "public",
      "--tag",
      "snapshot",
      "--registry",
      "https://registry.npmjs.org/",
      "--json",
    ]);
  });

  const sourceSha = "a".repeat(40);
  const version = "2.0.0-snapshot.20";
  const base = {
    name: "@spine-event-engine/proto",
    version,
    tarball: "proto.tgz",
    integrity: "sha512-YQ==",
  };
  const dependent = { ...base, name: "@spine-event-engine/core", tarball: "core.tgz" };
  const release = { tag: "snapshot", version, sourceSha, packages: [base, dependent] };
  const statement = (entry) => ({
    predicateType: "https://slsa.dev/provenance/v1",
    subject: [{ name: `pkg:npm/%40${entry.name.slice(1)}@${version}`, digest: { sha512: "61" } }],
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
  });
  const attestations = (entry) => ({
    attestations: [
      {
        bundle: {
          mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
          dsseEnvelope: {
            payloadType: "application/vnd.in-toto+json",
            payload: Buffer.from(JSON.stringify(statement(entry))).toString("base64"),
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
  });
  const registry =
    (visible, tagReads = []) =>
    async (kind, entry) => {
      if (kind === "tags") {
        tagReads.push(entry.name);
        return visible.has(entry.name)
          ? { snapshot: version, latest: "1.0.0" }
          : { latest: "1.0.0" };
      }
      if (!visible.has(entry.name)) return undefined;
      if (kind === "artifact")
        return {
          name: entry.name,
          version,
          dist: {
            integrity: entry.integrity,
            attestations: {
              url: `https://registry.npmjs.org/-/npm/v1/attestations/${entry.name.replace("/", "%2f")}@${version}`,
            },
          },
        };
      return attestations(entry);
    };

  it("persists attempts before npm, retries only the proven conflict, and confirms in dependency order", async () => {
    const visible = new Set();
    const snapshots = [];
    const calls = [];
    const tags = [];
    const report = await publishPrepared({
      release,
      registry: registry(visible, tags),
      save: async (value) => snapshots.push(globalThis.structuredClone(value)),
      invoke: async (archive, tag) => {
        calls.push([archive, tag]);
        if (calls.length === 1) return { status: 1, stdout: JSON.stringify(conflict) };
        visible.add(archive === base.tarball ? base.name : dependent.name);
        return { status: 0, stdout: "{}" };
      },
    });
    expect(calls).toEqual([
      ["proto.tgz", "snapshot"],
      ["proto.tgz", "snapshot"],
      ["core.tgz", "snapshot"],
    ]);
    expect(snapshots.some((value) => value.packages[0].attempts[0]?.result === "started")).toBe(
      true,
    );
    expect(tags.filter((name) => name === base.name)).toHaveLength(3);
    await confirmPrepared({
      release,
      report,
      registry: registry(visible),
      save: async () => {},
      now: () => 0,
      windowMs: 1_000,
    });
    expect(report.packages.map(({ status }) => status)).toEqual(["published", "published"]);
  });

  it("records accepted uploads as published without reading post-upload visibility", async () => {
    const calls = [];
    const report = await publishPrepared({
      release,
      registry: async (kind, entry) => {
        calls.push(`${kind}:${entry.name}`);
        return kind === "tags" ? { latest: "1.0.0" } : undefined;
      },
      save: async () => {},
      invoke: async () => ({ status: 0, stdout: "{}" }),
    });
    expect(report.packages.map(({ status }) => status)).toEqual(["published", "published"]);
    expect(calls.filter((call) => call.startsWith("artifact:"))).toHaveLength(2);
    expect(calls.filter((call) => call.startsWith("tags:"))).toHaveLength(4);
  });

  it("skips invisible accepted uploads on an immediate rerun", async () => {
    const prior = createPublicationReport(release);
    prior.packages[0].status = "published";
    prior.packages[0].attempts.push({ result: "accepted", diagnostics: { exitCode: 0 } });
    prior.packages[0].initialTags = { selected: undefined, opposite: "1.0.0" };
    vi.stubEnv("GITHUB_RUN_ATTEMPT", "2");
    const reads = [];
    const uploads = [];
    const report = await publishPrepared({
      release,
      prior,
      registry: async (kind, entry) => {
        reads.push(entry.name);
        return kind === "tags" ? { latest: "1.0.0" } : undefined;
      },
      save: async () => {},
      invoke: async (archive) => {
        uploads.push(archive);
        return { status: 0, stdout: "{}" };
      },
    });
    expect(reads).not.toContain(base.name);
    expect(uploads).toEqual([dependent.tarball]);
    expect(report.packages.map(({ status }) => status)).toEqual(["published", "published"]);
  });

  it("rejects contradictory accepted evidence before reads or writes", async () => {
    vi.stubEnv("GITHUB_RUN_ATTEMPT", "2");
    let calls = 0;
    for (const change of [
      (record) => {
        record.attempts[0].diagnostics.exitCode = 1;
      },
      (record) => {
        record.status = "failed";
      },
      (record) => {
        record.attempts.push({ result: "started" });
      },
    ]) {
      const prior = createPublicationReport(release);
      prior.runAttempt = 1;
      prior.packages[0].status = "published";
      prior.packages[0].attempts.push({ result: "accepted", diagnostics: { exitCode: 0 } });
      change(prior.packages[0]);
      await expect(
        publishPrepared({
          release,
          prior,
          registry: async () => {
            calls++;
            throw new Error("unexpected read");
          },
          save: async () => {},
          invoke: async () => {
            calls++;
            throw new Error("unexpected write");
          },
        }),
      ).rejects.toThrow("Invalid prior publication report package");
    }
    expect(calls).toBe(0);
  });

  it("rejects false pre-upload conflicts before reads or writes", async () => {
    vi.stubEnv("GITHUB_RUN_ATTEMPT", "2");
    let calls = 0;
    for (const diagnostics of [
      { exitCode: 0, ...conflict.error },
      { exitCode: 1 },
      { exitCode: 1, code: "E409", summary: conflict.error.summary, detail: conflict.error.detail },
    ]) {
      const prior = createPublicationReport(release);
      prior.runAttempt = 1;
      prior.packages[0].status = "failed";
      prior.packages[0].attempts.push({ result: "pre-upload-conflict", diagnostics });
      await expect(
        publishPrepared({
          release,
          prior,
          registry: async () => {
            calls++;
            throw new Error("unexpected read");
          },
          save: async () => {},
          invoke: async () => {
            calls++;
            throw new Error("unexpected write");
          },
        }),
      ).rejects.toThrow("Invalid prior publication report package");
    }
    expect(calls).toBe(0);
  });

  it("uses a proven saved pre-upload conflict for one bounded rerun", async () => {
    const prior = createPublicationReport(release);
    prior.packages[0].status = "failed";
    prior.packages[0].attempts.push({
      result: "pre-upload-conflict",
      diagnostics: {
        exitCode: 1,
        ...conflict.error,
      },
    });
    vi.stubEnv("GITHUB_RUN_ATTEMPT", "2");
    const uploads = [];
    const result = await publishPrepared({
      release,
      prior,
      registry: registry(new Set()),
      save: async () => {},
      invoke: async (archive) => {
        uploads.push(archive);
        return { status: 0, stdout: "{}" };
      },
    });
    expect(uploads).toEqual([base.tarball, dependent.tarball]);
    expect(result.packages[0].attempts.map(({ result }) => result)).toEqual([
      "pre-upload-conflict",
      "accepted",
    ]);
  });

  it("does not turn a formerly visible version's disappearance into upload permission", async () => {
    const prior = createPublicationReport(release);
    prior.packages[0].status = "already present";
    vi.stubEnv("GITHUB_RUN_ATTEMPT", "2");
    let uploads = 0;
    await expect(
      publishPrepared({
        release,
        prior,
        registry: async (kind) => (kind === "tags" ? { latest: "1.0.0" } : undefined),
        save: async () => {},
        invoke: async () => {
          uploads++;
          return { status: 0, stdout: "{}" };
        },
      }),
    ).rejects.toThrow("Prior published version is missing");
    expect(uploads).toBe(0);
  });

  it.each([
    ["repeated conflict", JSON.stringify(conflict), 2, true],
    [
      "registry upload conflict",
      JSON.stringify({ error: { code: "E409", summary: "409 Conflict" } }),
      1,
      false,
    ],
    [
      "authentication failure",
      JSON.stringify({ error: { code: "E401", summary: "Unauthorized" } }),
      1,
      false,
    ],
    ["unknown response", "not JSON", 1, false],
  ])("stops after %s without publishing later packages", async (_name, output, attempts, fails) => {
    const calls = [];
    let saved;
    const operation = publishPrepared({
      release,
      registry: registry(new Set()),
      save: async (value) => {
        saved = globalThis.structuredClone(value);
      },
      invoke: async () => {
        calls.push("npm");
        return { status: 1, stdout: output };
      },
    });
    if (fails) await expect(operation).rejects.toThrow("npm publish failed");
    else expect((await operation).packages[0].status).toBe("unconfirmed");
    expect(calls).toHaveLength(attempts);
    expect(saved.packages[1].status).toBe("not attempted");
  });

  it("accepts an ambiguous npm result only after positive exact-version confirmation", async () => {
    const visible = new Set();
    const calls = [];
    const report = await publishPrepared({
      release,
      registry: registry(visible),
      save: async () => {},
      invoke: async (archive) => {
        calls.push(archive);
        visible.add(archive === base.tarball ? base.name : dependent.name);
        return {
          status: calls.length === 1 ? 1 : 0,
          stdout: calls.length === 1 ? JSON.stringify({ error: { code: "E409" } }) : "{}",
        };
      },
    });
    expect(calls).toEqual([base.tarball, dependent.tarball]);
    expect(report.packages[0].status).toBe("published");
  });

  it("blocks a missing version after an earlier attempt started", async () => {
    const prior = createPublicationReport(release);
    prior.packages[0].attempts.push({ result: "started" });
    vi.stubEnv("GITHUB_RUN_ATTEMPT", "2");
    await expect(
      publishPrepared({
        release,
        prior,
        registry: registry(new Set()),
        save: async () => {},
        invoke: async () => {
          throw new Error("unexpected upload");
        },
      }),
    ).rejects.toThrow("Prior upload outcome");
  });

  it("never resends an uncertain upload when a rerun still sees 404", async () => {
    const prior = await publishPrepared({
      release,
      registry: registry(new Set()),
      save: async () => {},
      invoke: async () => ({ status: 1, stdout: JSON.stringify({ error: { code: "E409" } }) }),
    });
    expect(prior.packages[0].status).toBe("unconfirmed");
    vi.stubEnv("GITHUB_RUN_ATTEMPT", "2");
    let uploads = 0;
    await expect(
      publishPrepared({
        release,
        prior,
        registry: registry(new Set()),
        save: async () => {},
        invoke: async () => {
          uploads++;
          return { status: 0, stdout: "{}" };
        },
      }),
    ).rejects.toThrow("Prior upload outcome");
    expect(uploads).toBe(0);
  });

  it("never exceeds two conflict attempts across job reruns", async () => {
    const prior = createPublicationReport(release);
    prior.packages[0].attempts.push(
      globalThis.structuredClone(savedConflict),
      globalThis.structuredClone(savedConflict),
    );
    prior.packages[0].status = "failed";
    vi.stubEnv("GITHUB_RUN_ATTEMPT", "2");
    let calls = 0;
    await expect(
      publishPrepared({
        release,
        prior,
        registry: registry(new Set()),
        save: async () => {},
        invoke: async () => {
          calls++;
        },
      }),
    ).rejects.toThrow("Prior upload outcome");
    expect(calls).toBe(0);
    prior.packages[0].attempts.pop();
    await expect(
      publishPrepared({
        release,
        prior,
        registry: registry(new Set()),
        save: async () => {},
        invoke: async () => {
          calls++;
          return { status: 1, stdout: JSON.stringify(conflict) };
        },
      }),
    ).rejects.toThrow("npm publish failed");
    expect(calls).toBe(1);
  });

  it("rejects stale or malformed attempt evidence before npm", async () => {
    const prior = createPublicationReport(release);
    prior.packages[0].attempts.push(globalThis.structuredClone(savedConflict));
    prior.packages[0].status = "failed";
    vi.stubEnv("GITHUB_RUN_ATTEMPT", "3");
    let calls = 0;
    const options = {
      release,
      prior,
      registry: registry(new Set()),
      save: async () => {},
      invoke: async () => {
        calls++;
        return { status: 1, stdout: JSON.stringify(conflict) };
      },
    };
    await expect(publishPrepared(options)).rejects.toThrow(
      "Invalid prior publication report identity",
    );
    prior.runAttempt = "2";
    await expect(publishPrepared(options)).rejects.toThrow(
      "Invalid prior publication report identity",
    );
    delete prior.runAttempt;
    await expect(publishPrepared(options)).rejects.toThrow(
      "Invalid prior publication report identity",
    );
    expect(calls).toBe(0);
  });

  it("permits an old report for read-only inspection without authorizing a write", () => {
    const prior = createPublicationReport(release);
    vi.stubEnv("GITHUB_RUN_ATTEMPT", "3");
    expect(() => validatePriorReport(prior, release)).not.toThrow();
    expect(() => validatePriorReport(prior, release, true)).toThrow(
      "Invalid prior publication report identity",
    );
  });

  it("uses only the immediate prior attempt and preserves the retry cap", async () => {
    vi.stubEnv("GITHUB_RUN_ATTEMPT", "2");
    const prior = createPublicationReport(release);
    prior.packages[0].attempts.push(globalThis.structuredClone(savedConflict));
    prior.packages[0].status = "failed";
    vi.stubEnv("GITHUB_RUN_ATTEMPT", "3");
    let calls = 0;
    let saved;
    await expect(
      publishPrepared({
        release,
        prior,
        registry: registry(new Set()),
        save: async (value) => {
          saved = globalThis.structuredClone(value);
        },
        invoke: async () => {
          calls++;
          return { status: 1, stdout: JSON.stringify(conflict) };
        },
      }),
    ).rejects.toThrow("npm publish failed");
    expect(calls).toBe(1);
    expect(saved.runAttempt).toBe(3);
    expect(saved.packages[0].attempts).toHaveLength(2);
  });

  it("distinguishes delayed provenance from contradictory source identity", async () => {
    expect(hasExpectedProvenance(base, sourceSha, undefined)).toBe(false);
    expect(hasExpectedProvenance(base, sourceSha, attestations(base))).toBe(true);
    const wrong = attestations(base);
    const statementValue = statement(base);
    statementValue.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = "b".repeat(
      40,
    );
    wrong.attestations[0].bundle.dsseEnvelope.payload = Buffer.from(
      JSON.stringify(statementValue),
    ).toString("base64");
    expect(() => hasExpectedProvenance(base, sourceSha, wrong)).toThrow("Contradictory");
  });

  it.each([
    "signature",
    "malformed signature",
    "certificate",
    "transparency log",
    "verification material",
  ])("keeps a matching payload unconfirmed without its %s material", (part) => {
    const response = attestations(base);
    const bundle = response.attestations[0].bundle;
    if (part === "signature") bundle.dsseEnvelope.signatures = [];
    if (part === "malformed signature") bundle.dsseEnvelope.signatures[0].sig = "!bad";
    if (part === "certificate") bundle.verificationMaterial.certificate = {};
    if (part === "transparency log") bundle.verificationMaterial.tlogEntries = [];
    if (part === "verification material") delete bundle.verificationMaterial;
    expect(hasExpectedProvenance(base, sourceSha, response)).toBe(false);
  });

  it("rejects a v0.3 bundle missing inclusion proof despite an inclusion promise", () => {
    const response = attestations(base);
    delete response.attestations[0].bundle.verificationMaterial.tlogEntries[0].inclusionProof;
    expect(hasExpectedProvenance(base, sourceSha, response)).toBe(false);
  });

  it("accepts a complete proof-only v0.3 bundle", () => {
    const response = attestations(base);
    delete response.attestations[0].bundle.verificationMaterial.tlogEntries[0].inclusionPromise;
    expect(hasExpectedProvenance(base, sourceSha, response)).toBe(true);
  });

  it("rejects a v0.3 bundle with multiple DSSE signatures", () => {
    const response = attestations(base);
    response.attestations[0].bundle.dsseEnvelope.signatures.push({ sig: "c2ln", keyid: "" });
    expect(hasExpectedProvenance(base, sourceSha, response)).toBe(false);
  });

  it("rejects a v0.3 log entry without kindVersion", () => {
    const response = attestations(base);
    delete response.attestations[0].bundle.verificationMaterial.tlogEntries[0].kindVersion;
    expect(hasExpectedProvenance(base, sourceSha, response)).toBe(false);
  });

  it("rejects a malformed sibling beside a valid v0.3 log entry", () => {
    const response = attestations(base);
    const entries = response.attestations[0].bundle.verificationMaterial.tlogEntries;
    entries.push({ ...entries[0], kindVersion: undefined });
    expect(hasExpectedProvenance(base, sourceSha, response)).toBe(false);
  });

  it("rejects rollback and missing provenance before any npm invocation", async () => {
    const calls = [];
    const newerTags = async (kind, entry) =>
      kind === "tags" && entry.name === dependent.name
        ? { snapshot: "2.0.0-snapshot.21" }
        : registry(new Set())(kind, entry);
    await expect(
      publishPrepared({
        release,
        registry: newerTags,
        save: async () => {},
        invoke: async () => {
          calls.push("npm");
        },
      }),
    ).rejects.toThrow("rollback");
    const pending = async (kind, entry) =>
      entry.name === dependent.name
        ? kind === "tags"
          ? { snapshot: version }
          : kind === "artifact"
            ? { name: entry.name, version, dist: { integrity: entry.integrity } }
            : undefined
        : registry(new Set())(kind, entry);
    await expect(
      publishPrepared({
        release,
        registry: pending,
        save: async () => {},
        invoke: async () => {
          calls.push("npm");
        },
      }),
    ).rejects.toThrow("Unconfirmed existing provenance");
    expect(calls).toEqual([]);
  });

  it.each(["snapshot", "latest"])(
    "rejects exact-version 404 when the %s tag claims the target version",
    async (tag) => {
      let calls = 0;
      await expect(
        publishPrepared({
          release,
          registry: async (kind) => (kind === "tags" ? { [tag]: version } : undefined),
          save: async () => {},
          invoke: async () => {
            calls++;
          },
        }),
      ).rejects.toThrow("Registry version and tag evidence disagree");
      expect(calls).toBe(0);
    },
  );

  it("saves a confirmed first package before the shared deadline expires", async () => {
    const report = createPublicationReport(release);
    for (const record of report.packages) record.status = "unconfirmed";
    let time = 0;
    const snapshots = [];
    await confirmPrepared({
      release,
      report,
      registry: async (kind, entry) => {
        if (kind === "artifact") {
          time = 1;
          return {
            name: entry.name,
            version,
            dist: {
              integrity: entry.integrity,
              attestations: {
                url: `https://registry.npmjs.org/-/npm/v1/attestations/${entry.name.replace("/", "%2f")}@${version}`,
              },
            },
          };
        }
        if (kind === "tags") return { snapshot: version };
        time = 3;
        return attestations(entry);
      },
      save: async (value) => snapshots.push(globalThis.structuredClone(value)),
      now: () => time,
      windowMs: 2,
    });
    expect(snapshots.at(-1).packages[0].status).toBe("already present");
    expect(report.packages[1].status).toBe("unconfirmed");
  });

  it("waits when exact metadata precedes the selected tag, then confirms without npm", async () => {
    const report = createPublicationReport(release);
    report.packages[0].status = "unconfirmed";
    report.packages[0].attempts.push({ result: "accepted" });
    let time = 0;
    let reads = 0;
    await confirmPrepared({
      release,
      report,
      registry: async (kind, entry) => {
        if (kind === "artifact") {
          reads++;
          return {
            name: entry.name,
            version,
            dist: {
              integrity: entry.integrity,
              attestations: {
                url: `https://registry.npmjs.org/-/npm/v1/attestations/${entry.name.replace("/", "%2f")}@${version}`,
              },
            },
          };
        }
        if (kind === "tags") return reads > 1 ? { snapshot: version } : {};
        return attestations(entry);
      },
      save: async () => {},
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
      windowMs: 2_000,
    });
    expect(reads).toBe(2);
    expect(report.packages[0].status).toBe("published");
    expect(time).toBe(1_000);
  });

  it("retains a fresh confirmation while another package remains pending", async () => {
    const report = createPublicationReport(release);
    report.packages[0].status = "published";
    report.packages[0].attempts.push({ result: "accepted" });
    report.packages[1].status = "unconfirmed";
    const visible = new Set([base.name]);
    const read = registry(visible);
    let baseReads = 0;
    let dependentReads = 0;
    let time = 0;
    await confirmPrepared({
      release,
      report,
      registry: async (kind, entry) => {
        if (kind === "artifact" && entry.name === base.name && ++baseReads > 1)
          throw new TemporaryRegistryError("later outage");
        if (kind === "artifact" && entry.name === dependent.name && ++dependentReads > 1)
          visible.add(dependent.name);
        return read(kind, entry);
      },
      save: async () => {},
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
      windowMs: 1_500,
    });
    expect(baseReads).toBe(1);
    expect(dependentReads).toBe(2);
    expect(report.packages.map(({ status }) => status)).toEqual(["published", "already present"]);
  });

  it("rejects visible metadata with a wrong selected tag before npm", async () => {
    let calls = 0;
    await expect(
      publishPrepared({
        release,
        registry: async (kind, entry) =>
          kind === "artifact"
            ? { name: entry.name, version, dist: { integrity: entry.integrity } }
            : { snapshot: "2.0.0-snapshot.18" },
        save: async () => {},
        invoke: async () => {
          calls++;
        },
      }),
    ).rejects.toThrow("Selected tag mismatch");
    expect(calls).toBe(0);
  });

  it("reads exact npm resources and fails closed on malformed or denied responses", async () => {
    const paths = [];
    const read = createPublicRegistry(async (url) => {
      paths.push(url);
      return { status: 404, ok: false };
    });
    expect(await read("artifact", base)).toBeUndefined();
    expect(await read("tags", base)).toEqual({});
    expect(paths).toEqual([
      `https://registry.npmjs.org/%40spine-event-engine%2Fproto/${version}`,
      "https://registry.npmjs.org/-/package/%40spine-event-engine%2Fproto/dist-tags",
    ]);
    const denied = createPublicRegistry(async () => ({ status: 401, ok: false }));
    await expect(denied("artifact", base)).rejects.toThrow("401");
    const malformed = createPublicRegistry(async () => ({
      status: 200,
      ok: true,
      json: async () => [],
    }));
    await expect(malformed("tags", base)).rejects.toThrow("Invalid registry tags");
  });

  it("keeps a timed-out confirmation unconfirmed and recovers within the shared window", async () => {
    const one = { ...release, packages: [base] };
    const report = createPublicationReport(one);
    report.packages[0].status = "unconfirmed";
    report.packages[0].attempts.push({ result: "accepted" });
    let failures = 0;
    const registry = createPublicRegistry(async (url) => {
      if (url.includes("/dist-tags"))
        return { status: 200, ok: true, json: async () => ({ snapshot: version }) };
      if (url.includes("/attestations/"))
        return { status: 200, ok: true, json: async () => attestations(base) };
      if (failures++ < 3) return { status: 200, ok: true, json: () => new Promise(() => {}) };
      return {
        status: 200,
        ok: true,
        json: async () => ({
          name: base.name,
          version,
          dist: {
            integrity: base.integrity,
            attestations: {
              url: `https://registry.npmjs.org/-/npm/v1/attestations/${base.name.replace("/", "%2f")}@${version}`,
            },
          },
        }),
      };
    }, 5);
    const snapshots = [];
    await confirmPrepared({
      release: one,
      report,
      registry,
      save: async (value) => snapshots.push(globalThis.structuredClone(value)),
      windowMs: 2_000,
      sleep: async () => {},
    });
    expect(report.packages[0].status).toBe("published");
    expect(snapshots.some((item) => item.packages[0].status === "unconfirmed")).toBe(true);
    expect(failures).toBe(4);
  });

  it("keeps missing confirmation unconfirmed within one shared deadline", async () => {
    const report = createPublicationReport(release);
    report.packages[0].status = "unconfirmed";
    report.packages[0].attempts.push({ result: "accepted" });
    let time = 0;
    const reads = [];
    await confirmPrepared({
      release,
      report,
      registry: async (kind, _entry, limit) => {
        reads.push({ kind, limit });
        return kind === "tags" ? {} : undefined;
      },
      save: async () => {},
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
      windowMs: 3,
    });
    expect(report.packages[0].status).toBe("unconfirmed");
    expect(reads.every(({ limit }) => limit <= 3)).toBe(true);
  });

  it("publishes and confirms all 19 public packages in dependency order", async () => {
    const root = new URL("..", import.meta.url).pathname;
    const model = expectedReleaseModel(readReleaseManifests(root));
    const entries = model.packages.map((entry) => ({
      ...entry,
      version,
      tarball: entry.name.split("/")[1] + ".tgz",
      integrity: "sha512-YQ==",
    }));
    const full = { ...model, version, sourceSha, packages: entries };
    const byArchive = new Map(entries.map((entry) => [entry.tarball, entry.name]));
    const visible = new Set();
    const calls = [];
    const report = await publishPrepared({
      release: full,
      registry: registry(visible),
      save: async () => {},
      invoke: async (archive) => {
        const name = byArchive.get(archive);
        calls.push(name);
        visible.add(name);
        return { status: 0, stdout: "{}" };
      },
    });
    await confirmPrepared({
      release: full,
      report,
      registry: registry(visible),
      save: async () => {},
      now: () => 0,
      windowMs: 1_000,
    });
    expect(calls).toEqual(entries.map(({ name }) => name));
    expect(report.packages).toHaveLength(19);
    expect(report.packages.every(({ status }) => status === "published")).toBe(true);
    for (const entry of entries)
      for (const dependency of entry.dependencies)
        expect(calls.indexOf(dependency)).toBeLessThan(calls.indexOf(entry.name));
  });
});
