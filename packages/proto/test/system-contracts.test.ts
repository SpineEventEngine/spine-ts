import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface SourceEntry {
  readonly localPath: string;
  readonly commit: string;
  readonly upstreamPath: string;
  readonly sha256: string;
}

interface SourceManifest {
  readonly sources: readonly SourceEntry[];
  readonly ownedSources?: readonly {
    readonly localPath: string;
    readonly sha256: string;
  }[];
}

function source(manifest: SourceManifest, localPath: string): SourceEntry {
  const entry = manifest.sources.find((candidate) => candidate.localPath === localPath);
  if (entry === undefined) {
    throw new Error(`Expected frozen source ${localPath}.`);
  }
  return entry;
}

function ownedSource(manifest: SourceManifest, localPath: string): { readonly sha256: string } {
  const entry = manifest.ownedSources?.find((candidate) => candidate.localPath === localPath);
  if (entry === undefined) {
    throw new Error(`Expected Spine TS-owned source ${localPath}.`);
  }
  return entry;
}

describe("distributed delivery system contracts", () => {
  it("pins the JVM EntityStateChanged event and its dependency byte-for-byte", () => {
    const manifest = JSON.parse(
      readFileSync(resolve("packages/proto/proto/spine-sources.json"), "utf8"),
    ) as SourceManifest;
    const commit = "461a8281e484c12636d8cf660a1d6c929fbbd7ec";

    for (const [localPath, upstreamPath] of [
      [
        "packages/proto/proto/spine/system/server/entity_log_events.proto",
        "server/src/main/proto/spine/system/server/entity_log_events.proto",
      ],
      [
        "packages/proto/proto/spine/system/server/entity_type.proto",
        "server/src/main/proto/spine/system/server/entity_type.proto",
      ],
    ] as const) {
      const entry = source(manifest, localPath);
      expect(entry.commit).toBe(commit);
      expect(entry.upstreamPath).toBe(upstreamPath);
      expect(createHash("sha256").update(readFileSync(resolve(localPath))).digest("hex")).toBe(
        entry.sha256,
      );
    }
  });

  it("keeps EntityStateChanged and the Stand record on their exact wire shapes", () => {
    const eventSource = readFileSync(
      resolve("packages/proto/proto/spine/system/server/entity_log_events.proto"),
      "utf8",
    );
    const standSource = readFileSync(
      resolve("packages/proto/proto/spine/system/server/stand_subscription.proto"),
      "utf8",
    );

    expect(eventSource).toContain("package spine.system.server;");
    expect(eventSource).toContain('option (type_url_prefix) = "type.spine.io";');
    expect(eventSource).toMatch(/core\.MessageId entity = 1 \[\(required\) = true\];/u);
    expect(eventSource).toMatch(/google\.protobuf\.Any new_state = 2 \[\(required\) = true\];/u);
    expect(eventSource).toMatch(
      /repeated core\.MessageId signal_id = 3 \[\(required\) = true, \(validate\) = true\];/u,
    );
    expect(eventSource).toMatch(/google\.protobuf\.Timestamp when = 4;/u);
    expect(eventSource).toMatch(/core\.Version new_version = 5;/u);
    expect(eventSource).toMatch(/google\.protobuf\.Any old_state = 6;/u);

    expect(standSource).toContain("option (internal_all) = true;");
    expect(standSource).toMatch(/spine\.client\.Subscription subscription = 1;/u);
    expect(standSource).toMatch(/SubscriptionPhase phase = 2;/u);
    expect(standSource).toMatch(/google\.protobuf\.Timestamp created_at = 3;/u);
    expect(standSource).toMatch(/google\.protobuf\.Timestamp pending_until = 4;/u);
    expect(standSource).toMatch(/uint64 revision = 5;/u);
    expect(standSource).not.toContain("Topic topic");
  });

  it("records the owned Stand contract and reuses the frozen Inbox labels", () => {
    const manifest = JSON.parse(
      readFileSync(resolve("packages/proto/proto/spine-sources.json"), "utf8"),
    ) as SourceManifest;
    const owned = ownedSource(
      manifest,
      "packages/proto/proto/spine/system/server/stand_subscription.proto",
    );
    const standBytes = readFileSync(
      resolve("packages/proto/proto/spine/system/server/stand_subscription.proto"),
    );
    const inboxSource = readFileSync(
      resolve("packages/proto/proto/spine/server/delivery/inbox.proto"),
      "utf8",
    );

    expect(createHash("sha256").update(standBytes).digest("hex")).toBe(owned.sha256);
    expect(inboxSource).toMatch(/HANDLE_COMMAND = 1;/u);
    expect(inboxSource).toMatch(/UPDATE_SUBSCRIBER = 3;/u);
    expect(inboxSource).toMatch(/REACT_UPON_EVENT = 4;/u);
  });
});
