import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { prepareFixture } from "../fixture.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const expectedServices = [
  "spine.client.CommandService/Post:unary",
  "spine.client.QueryService/Read:unary",
  "spine.client.SubscriptionService/Subscribe:unary",
  "spine.client.SubscriptionService/Activate:server_streaming",
  "spine.client.SubscriptionService/Cancel:unary",
];
const closureSeeds = [
  "spine/client/command_service.proto",
  "spine/client/query_service.proto",
  "spine/client/subscription_service.proto",
  "spine/client/query.proto",
  "spine/client/subscription.proto",
  "spine/core/actor_context.proto",
  "spine/core/command.proto",
  "spine/core/event.proto",
];
const frozenProvenance = Object.freeze({
  pomDigest: "23b875e2a0b80f14e4fa908f6ced51e05ac84211fd73281c949a3acffae85857",
  coordinates: Object.freeze([
    "io.spine:spine-base:2.0.0-SNAPSHOT.426",
    "io.spine:spine-base-types:2.0.0-SNAPSHOT.224",
    "io.spine:spine-time:2.0.0-SNAPSHOT.244",
  ]),
  categories: Object.freeze({ compared: 16, unresolvedWire: 6, annotationOnly: 1, googleWkt: 8 }),
});

/** Checks repository-owned Proto sources and TS-generated schemas without a JVM operation. */
export async function verifyWireCompatibility(options = {}) {
  const services = options.services ?? expectedServices;
  if (services.join("\n") !== expectedServices.join("\n"))
    throw new Error("descriptor incompatibility: required service closure changed");
  let closure;
  const fixture = await prepareFixture({
    afterExtraction: async (source) => {
      await assertFrozenProvenance(source);
      closure = await compareProtoClosure(source);
    },
  });
  if (closure === undefined)
    throw new Error("file incompatibility: extracted source was unavailable");
  const generated = await verifyTypeScriptFixtures();
  return {
    services,
    files: closure.files,
    closureFiles: closure.files,
    closureDigest: closure.digest,
    excludedImports: closure.excludedImports,
    fixtureDigest: createHash("sha256").update(generated).digest("hex"),
    revision: fixture.archive.endsWith(".zip") ? fixture.sourceDigest : undefined,
    sourceDigest: fixture.sourceDigest,
    capabilities: fixture.capabilities,
    staticEvidence: "static compatibility evidence; JVM runtime compatibility deferred",
  };
}

export async function assertFrozenProvenance(source, expected = frozenProvenance) {
  const pom = await readFile(resolve(source, "docs/dependencies/pom.xml"));
  assertPomProvenance(pom, expected);
  assertImportCategories(expected.categories);
  return expected;
}

export function assertPomProvenance(pom, expected = frozenProvenance) {
  const digest = createHash("sha256").update(pom).digest("hex");
  if (digest !== expected.pomDigest)
    throw new Error("provenance incompatibility: frozen POM digest changed");
  const text = pom.toString("utf8");
  for (const coordinate of expected.coordinates) {
    const [, artifact, version] = coordinate.split(":");
    if (
      !text.includes(`<artifactId>${artifact}</artifactId>`) ||
      !text.includes(`<version>${version}</version>`)
    )
      throw new Error(`provenance incompatibility: frozen POM coordinate changed: ${coordinate}`);
  }
}

export function assertImportCategories(categories) {
  if (
    categories.compared !== 16 ||
    categories.unresolvedWire !== 6 ||
    categories.annotationOnly !== 1 ||
    categories.googleWkt !== 8
  )
    throw new Error("category incompatibility: frozen import category manifest changed");
}

async function compareProtoClosure(source) {
  const remaining = [...closureSeeds];
  const visited = new Set();
  const excludedImports = {};
  const annotationOnlyExternals = {};
  const missingWireFiles = [];
  const digests = [];
  const archiveFiles = await archiveProtoFiles(source);
  while (remaining.length > 0) {
    const file = remaining.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const repositoryPath = resolve(root, "packages/proto/proto", file);
    let repository;
    try {
      repository = await readFile(repositoryPath);
    } catch (error) {
      throw new Error(
        `file incompatibility: unable to read ${file}: ${error.code ?? error.message}`,
      );
    }
    const archivePaths = archiveFiles.get(file);
    if (archivePaths === undefined) {
      if (annotationOnlyImport(file))
        annotationOnlyExternals[file] = createHash("sha256").update(repository).digest("hex");
      else missingWireFiles.push(file);
    } else {
      const upstream = await readArchiveProto(archivePaths, file);
      if (!upstream.equals(repository))
        throw new Error(`file incompatibility: bytes differ for ${file}`);
      digests.push(`${file}:${createHash("sha256").update(upstream).digest("hex")}`);
    }
    for (const imported of importsOf(repository)) {
      const reason = imported.startsWith("google/protobuf/") ? "Google well-known type" : undefined;
      if (reason !== undefined) excludedImports[imported] = reason;
      else remaining.push(imported);
    }
  }
  const files = [...visited].sort();
  const manifest = files
    .map((file) => digests.find((digest) => digest.startsWith(`${file}:`)))
    .join("\n");
  const inventory = {
    files,
    digest: createHash("sha256").update(manifest).digest("hex"),
    excludedImports: Object.fromEntries(
      Object.entries(excludedImports).sort(([left], [right]) => left.localeCompare(right)),
    ),
    annotationOnlyExternals: Object.fromEntries(
      Object.entries(annotationOnlyExternals).sort(([left], [right]) => left.localeCompare(right)),
    ),
    missingWireFiles: missingWireFiles.sort(),
  };
  if (inventory.missingWireFiles.length > 0)
    throw new Error(
      `file incompatibility: missing wire-bearing imports (${inventory.missingWireFiles.length}): ${inventory.missingWireFiles.join(", ")}; compared=${digests.length}; annotation-only=${Object.keys(inventory.annotationOnlyExternals).length}; wkt=${Object.keys(inventory.excludedImports).length}`,
    );
  return inventory;
}

function annotationOnlyImport(file) {
  return file === "spine/options.proto";
}

async function archiveProtoFiles(source) {
  const paths = new Map();
  for (const entry of await allFiles(source)) {
    const marker = `${sep}src${sep}main${sep}proto${sep}`;
    const markerIndex = entry.lastIndexOf(marker);
    if (markerIndex === -1) continue;
    const relativePath = entry
      .slice(markerIndex + marker.length)
      .split(sep)
      .join("/");
    if (!relativePath.startsWith("spine/") || !relativePath.endsWith(".proto")) continue;
    const candidates = paths.get(relativePath) ?? [];
    candidates.push(entry);
    paths.set(relativePath, candidates);
  }
  return paths;
}

async function allFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const children = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? allFiles(path) : [path];
    }),
  );
  return children.flat();
}

async function readArchiveProto(paths, file) {
  if (paths === undefined || paths.length === 0)
    throw new Error(`file incompatibility: frozen archive is missing ${file}`);
  const sorted = [...paths].sort();
  const bytes = await Promise.all(sorted.map((path) => readFile(path)));
  if (bytes.some((candidate) => !candidate.equals(bytes[0])))
    throw new Error(`file incompatibility: ambiguous frozen archive paths for ${file}`);
  return bytes[0];
}

function importsOf(source) {
  return [...source.toString("utf8").matchAll(/^\s*import\s+"([^\"]+)"\s*;/gm)].map(
    (match) => match[1],
  );
}

export async function verifyTypeScriptFixtures() {
  const client = await import("../../../packages/proto/dist/src/client/index.js");
  const core = await import("../../../packages/proto/dist/src/index.js");
  const protobuf =
    await import("../../../packages/proto/node_modules/@bufbuild/protobuf/dist/esm/index.js");
  const actor = protobuf.create(core.ActorContextSchema, {
    actor: { value: "fixture-actor" },
    timestamp: { seconds: 1n, nanos: 2 },
  });
  const topic = protobuf.create(client.TopicSchema, {
    id: { value: "fixture-topic" },
    target: { type: "type.example/Fixture", criterion: { case: "includeAll", value: true } },
    context: actor,
  });
  const subscription = protobuf.create(client.SubscriptionSchema, {
    id: { value: "fixture-subscription" },
    topic,
  });
  const response = { status: { case: "ok", value: {} } };
  const command = protobuf.create(core.CommandSchema, {
    id: { uuid: "fixture-command" },
    message: { typeUrl: "type.example/FixtureCommand", value: new Uint8Array([1, 2]) },
    context: { actorContext: actor, targetVersion: 3 },
  });
  const event = {
    id: { value: "fixture-event" },
    message: { typeUrl: "type.example/FixtureEvent", value: new Uint8Array([3, 4]) },
    context: { timestamp: { seconds: 2n }, origin: { case: "importContext", value: actor } },
  };
  const fixtures = [
    [core.CommandSchema, command],
    [
      core.AckSchema,
      {
        messageId: { typeUrl: "type.example/FixtureId", value: new Uint8Array([5]) },
        status: response,
      },
    ],
    [client.QuerySchema, { id: { value: "fixture-query" }, target: topic.target, context: actor }],
    [
      client.QueryResponseSchema,
      {
        response: { status: response },
        message: [
          {
            state: { typeUrl: "type.example/State", value: new Uint8Array([6]) },
            version: { value: 1n },
          },
        ],
      },
    ],
    [client.TopicSchema, topic],
    [client.SubscriptionSchema, subscription],
    [
      client.SubscriptionUpdateSchema,
      {
        subscription,
        response: { status: response },
        update: {
          case: "entityUpdates",
          value: {
            update: [
              {
                id: { typeUrl: "type.example/Id", value: new Uint8Array([7]) },
                kind: {
                  case: "state",
                  value: { typeUrl: "type.example/State", value: new Uint8Array([8]) },
                },
              },
            ],
          },
        },
      },
    ],
    [
      client.SubscriptionUpdateSchema,
      {
        subscription,
        response: { status: response },
        update: { case: "eventUpdates", value: { event: [event] } },
      },
    ],
    [core.ActorContextSchema, actor],
  ];
  const methodFixtures = [
    [client.CommandService.method.post.input, client.CommandService.method.post.output],
    [client.QueryService.method.read.input, client.QueryService.method.read.output],
    [
      client.SubscriptionService.method.subscribe.input,
      client.SubscriptionService.method.subscribe.output,
    ],
    [
      client.SubscriptionService.method.activate.input,
      client.SubscriptionService.method.activate.output,
    ],
    [
      client.SubscriptionService.method.cancel.input,
      client.SubscriptionService.method.cancel.output,
    ],
  ];
  const wires = fixtures.flatMap(([schema, value]) =>
    roundTrip(schema, protobuf.create(schema, value), protobuf),
  );
  const methodWires = methodFixtures.flatMap(([input, output]) => {
    const inputWire = protobuf.toBinary(input, protobuf.create(input));
    const outputWire = protobuf.toBinary(output, protobuf.create(output));
    if (
      !protobuf
        .toBinary(input, protobuf.fromBinary(input, inputWire))
        .every((byte, index) => byte === inputWire[index])
    )
      throw new Error("fixture incompatibility: input did not round trip");
    if (
      !protobuf
        .toBinary(output, protobuf.fromBinary(output, outputWire))
        .every((byte, index) => byte === outputWire[index])
    )
      throw new Error("fixture incompatibility: output did not round trip");
    return [inputWire, outputWire];
  });
  const unknown = Uint8Array.from([
    ...protobuf.toBinary(
      client.TopicIdSchema,
      protobuf.create(client.TopicIdSchema, { value: "unknown" }),
    ),
    0x98,
    0x06,
    0x01,
  ]);
  const preserved = protobuf.toBinary(
    client.TopicIdSchema,
    protobuf.fromBinary(client.TopicIdSchema, unknown),
  );
  if (!preserved.every((byte, index) => byte === unknown[index]))
    throw new Error("fixture incompatibility: unknown field was not preserved");
  return Buffer.concat([...wires, ...methodWires, Buffer.from(preserved)]);
}

function roundTrip(schema, message, protobuf) {
  const wire = protobuf.toBinary(schema, message);
  const replay = protobuf.toBinary(schema, protobuf.fromBinary(schema, wire));
  if (!replay.every((byte, index) => byte === wire[index]))
    throw new Error(`fixture incompatibility: ${schema.typeName} did not round trip`);
  return [wire];
}
