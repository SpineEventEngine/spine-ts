import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getOption } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { type_url_prefix } from "../src/index.js";
import * as curatedSchemas from "../src/index.js";
import { InboxLabel } from "../generated/spine/server/delivery/inbox_pb.js";
import { required, validate } from "../generated/spine/options_pb.js";
import {
  EntityStateChangedSchema,
  file_spine_system_server_entity_log_events,
} from "../generated/spine/system/server/entity_log_events_pb.js";
import { EntityTypeNameSchema } from "../generated/spine/system/server/entity_type_pb.js";
import {
  StandSubscriptionRecordSchema,
  SubscriptionPhase,
} from "../generated/spine/system/server/stand_subscription_pb.js";

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
      expect(
        createHash("sha256")
          .update(readFileSync(resolve(localPath)))
          .digest("hex"),
      ).toBe(entry.sha256);
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

  it("generates internal schemas with the exact field numbers and type URL prefix", () => {
    expect(EntityStateChangedSchema.typeName).toBe("spine.system.server.EntityStateChanged");
    expect(EntityTypeNameSchema.typeName).toBe("spine.system.server.EntityTypeName");
    expect(StandSubscriptionRecordSchema.typeName).toBe(
      "spine.system.server.StandSubscriptionRecord",
    );
    expect(getOption(file_spine_system_server_entity_log_events, type_url_prefix)).toBe(
      "type.spine.io",
    );
    expect(EntityStateChangedSchema.fields.map((field) => [field.name, field.number])).toEqual([
      ["entity", 1],
      ["old_state", 6],
      ["new_state", 2],
      ["signal_id", 3],
      ["when", 4],
      ["new_version", 5],
    ]);
    expect(StandSubscriptionRecordSchema.fields.map((field) => [field.name, field.number])).toEqual(
      [
        ["subscription", 1],
        ["phase", 2],
        ["created_at", 3],
        ["pending_until", 4],
        ["revision", 5],
      ],
    );
    expect(SubscriptionPhase.PENDING).toBe(1);
    expect(SubscriptionPhase.ACTIVE).toBe(2);
    expect(
      getOption(
        EntityStateChangedSchema.fields.find((field) => field.name === "entity"),
        required,
      ),
    ).toBe(true);
    expect(
      getOption(
        EntityStateChangedSchema.fields.find((field) => field.name === "signal_id"),
        required,
      ),
    ).toBe(true);
    expect(
      getOption(
        EntityStateChangedSchema.fields.find((field) => field.name === "signal_id"),
        validate,
      ),
    ).toBe(true);
    expect(
      getOption(
        StandSubscriptionRecordSchema.fields.find((field) => field.name === "pending_until"),
        required,
      ),
    ).toBe(false);
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
    expect(InboxLabel.HANDLE_COMMAND).toBe(1);
    expect(InboxLabel.UPDATE_SUBSCRIBER).toBe(3);
    expect(InboxLabel.REACT_UPON_EVENT).toBe(4);
  });

  it("keeps system contracts out of curated end-user exports", () => {
    expect(curatedSchemas).not.toHaveProperty("EntityStateChangedSchema");
    expect(curatedSchemas).not.toHaveProperty("EntityTypeNameSchema");
    expect(curatedSchemas).not.toHaveProperty("StandSubscriptionRecordSchema");
    const packageJson = JSON.parse(
      readFileSync(resolve("packages/proto/package.json"), "utf8"),
    ) as { readonly exports: Readonly<Record<string, unknown>> };

    expect(packageJson.exports).not.toHaveProperty("./system");
  });
});
