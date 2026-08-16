/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import {
  FileDescriptorProtoSchema,
  FileDescriptorSetSchema,
  StringValueSchema,
} from "@bufbuild/protobuf/wkt";
import { SignalEnvelopes, TypeUrls } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  EmailAddressSchema,
  EventContextSchema,
  EventIdSchema,
  UserIdSchema,
  file_spine_options,
} from "@spine-event-engine/proto";
import {
  BoundedContext,
  EnvironmentType,
  Projection,
  ServerEnvironment,
} from "@spine-event-engine/server";
import * as ZeroMq from "@spine-event-engine/transport/zeromq";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.ts";
import { boundedContextAccess } from "../../dist/context/bounded-context.js";

const role = requiredEnvironment("SPINE_WAVE13_ROLE");
const ipcDirectory = requiredEnvironment("SPINE_WAVE13_IPC_DIRECTORY");
const adapterIdentity = requiredEnvironment("SPINE_WAVE13_ADAPTER_IDENTITY");
const ProjectionStateSchema = generatedProjectionStateSchema();

class Wave13ExternalProjection extends Projection {
  onImportedEvent(event, context) {
    handled.push({ context, event });
  }
}

const observed = [];
const handled = [];
let context;
let registry;
let eventSubscription;
try {
  registry = await generatedRegistryRoot();
  if (typeof ZeroMq.createZeroMqTransportFactory !== "function") {
    throw new Error("Wave 13 requires createZeroMqTransportFactory(ZeroMqConfig).");
  }
  const factory = ZeroMq.createZeroMqTransportFactory(
    ZeroMq.ZeroMqConfig.create({ ipcDirectory, adapterIdentity }),
  );
  ServerEnvironment.when(EnvironmentType.Local).use({ transportFactory: factory });
  const builder = BoundedContext.singleTenant(`Wave13${capitalize(role)}`)
    .withGeneratedRegistryRoot(registry.root)
    .add(Wave13ExternalProjection);
  context = await builder.buildAsync();
  if (role === "consumer") {
    eventSubscription = boundedContextAccess.subscribeToEvent(
      context,
      TypeUrls.derive(EmailAddressSchema),
      {
        onEvent(event) {
          if (event.context?.external === true) observed.push(event);
        },
      },
    );
  }
  await send({
    type: "ready",
    pid: process.pid,
    role,
    contextName: context.name.value ?? context.name,
  });
} catch (error) {
  await cleanup();
  await send({
    type: "failure",
    role,
    reason: error instanceof Error ? error.message : String(error),
  });
}

process.on("message", async (message) => {
  try {
    if (
      (message?.type === "publish-readiness-probe" || message?.type === "publish-domestic-event") &&
      role === "producer"
    ) {
      const probe = message.type === "publish-readiness-probe";
      await context.eventBus().post(
        SignalEnvelopes.event({
          id: create(EventIdSchema, {
            value: probe ? "wave13-readiness-probe" : "wave13-cross-process-event",
          }),
          context: create(EventContextSchema, {
            origin: {
              case: "importContext",
              value: create(ActorContextSchema, {
                actor: create(UserIdSchema, { value: "Wave13Actor" }),
              }),
            },
            producerId: {
              typeUrl: "type.googleapis.com/google.protobuf.StringValue",
              value: toBinary(
                StringValueSchema,
                create(StringValueSchema, { value: "Wave13Producer" }),
              ),
            },
          }),
          schema: EmailAddressSchema,
          message: create(EmailAddressSchema, {
            value: probe ? "readiness-probe" : "full-event-payload",
          }),
        }),
      );
    }
    if (message?.type === "shutdown") {
      await cleanup();
      await send({ type: "stopped", role });
      process.exit(0);
    }
  } catch (error) {
    await send({
      type: "failure",
      role,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
});

if (role === "consumer" && context !== undefined) {
  try {
    await waitFor(
      () => observedEvent("wave13-readiness-probe") && handledPayload("readiness-probe"),
    );
    await send({ type: "probe-delivered", role: "consumer" });
    await waitFor(
      () => observedEvent("wave13-cross-process-event") && handledPayload("full-event-payload"),
    );
    const delivered = observed.find((event) => event.id.value === "wave13-cross-process-event");
    if (delivered === undefined) throw new Error("Expected the imported target Event.");
    await send({
      type: "delivered",
      role: "consumer",
      eventId: delivered.id.value,
      typeUrl: delivered.message.typeUrl,
      producerId: fromBinary(StringValueSchema, delivered.context.producerId.value).value,
      payload: fromBinary(EmailAddressSchema, delivered.message.value).value,
      origin: delivered.context.origin.case,
      actorId: delivered.context.origin.value.actor.value,
      tenantId: delivered.context.origin.value.tenantId?.kind.value,
      external: delivered.context.external,
    });
  } catch (error) {
    await cleanup();
    await send({
      type: "failure",
      role,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

function observedEvent(eventId) {
  return observed.some((event) => event.id.value === eventId);
}

function handledPayload(payload) {
  return handled.some(({ event }) => event.value === payload);
}

async function generatedRegistryRoot() {
  const directory = await mkdtemp(join(tmpdir(), `spine-wave13-registry-${role}-`));
  const moduleDirectory = join(directory, "generated/handler");
  const slot = `__spineWave13Registry_${process.pid}`;
  await mkdir(moduleDirectory, { recursive: true });
  globalThis[slot] = {
    version: 3,
    entities: [
      {
        entityType: Wave13ExternalProjection,
        stateSchema: ProjectionStateSchema,
        handlers: [
          {
            kind: "event-subscription",
            methodName: "onImportedEvent",
            signalSchema: EmailAddressSchema,
            emittedSchemas: [],
            parameterCount: 2,
            origin: "external",
          },
        ],
      },
    ],
  };
  await writeFile(
    join(moduleDirectory, "generated-handler-registry.js"),
    `export const generatedHandlerRegistry = globalThis[${JSON.stringify(slot)}];\n`,
  );
  return { directory, root: pathToFileURL(directory), slot };
}

function generatedProjectionStateSchema() {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(serverEntityMetadataTestFixtures.main.descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];
  if (descriptor === undefined) throw new Error("Wave 13 projection schema descriptor is missing.");
  return messageDesc(
    fileDesc(Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"), [
      file_spine_options,
    ]),
    0,
  );
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`Missing ${name}.`);
  return value;
}

function capitalize(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

async function waitFor(predicate) {
  const deadline = Date.now() + 3_000;
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error("Timed out waiting for generated external delivery.");
    await delay(10);
  }
}

function send(message) {
  return new Promise((resolve, reject) => {
    process.send?.(message, (error) => (error == null ? resolve() : reject(error)));
  });
}

async function cleanup() {
  eventSubscription?.unsubscribe();
  eventSubscription = undefined;
  if (context !== undefined) {
    await context.close();
    context = undefined;
  }
  await ServerEnvironment.instance().close();
  if (registry !== undefined) {
    delete globalThis[registry.slot];
    await rm(registry.directory, { recursive: true, force: true });
    registry = undefined;
  }
}
