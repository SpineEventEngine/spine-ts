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

import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AnyPacker, Identifiers, TypeRegistry, TypeUrls } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  CommandContextSchema,
  CommandIdSchema,
  CommandSchema,
  UserIdSchema,
} from "@spine-event-engine/proto";
import { InMemoryStorageBackend, InMemoryStorageFactory } from "@spine-event-engine/storage";
import { expect, it, vi } from "vitest";

import { Application } from "../../src/server/application.js";
import { BoundedContext } from "../../src/context/bounded-context.js";
import { ThirdPartyContext } from "../../src/integration/third-party-context.js";
import { ServerEnvironment, serverEnvironmentAccess } from "../../src/server/server-environment.js";
import { EnvironmentType } from "../../src/server/environment.js";
import { Inbox } from "../../src/delivery/inbox.js";
import { InboxStorage } from "../../src/delivery/inbox-storage.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import { ProcessManager, Projection } from "../../src/entity/entity.js";
import { HandlerMetadataValues } from "../../src/handler/handler-metadata.js";
import { Repository } from "../../src/repository/repository.js";
import { ProcessManagerStateSchema } from "../../test-fixtures/generated/entity-metadata/visibility_pb.js";
import { ProjectOverviewStateSchema } from "../../test-fixtures/generated/entity-metadata/project_states_pb.js";
import {
  type CreateReviewProject,
  CreateReviewProjectSchema,
} from "../../test-fixtures/generated/validation-refusal/project_commands_pb.js";
import {
  type ProjectCreated,
  ProjectCreatedSchema,
} from "../../test-fixtures/generated/repository-routing/project_events_pb.js";

const activationGate = vi.hoisted(() => ({
  enabled: false,
  entered: Promise.withResolvers<undefined>(),
  release: Promise.withResolvers<undefined>(),
  onActivate: undefined as ((name: string) => Promise<void>) | undefined,
  onIntegration: undefined as ((name: string) => Promise<void>) | undefined,
}));

vi.mock("../../src/context/bounded-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/context/bounded-context.js")>();
  return {
    ...actual,
    boundedContextAccess: {
      ...actual.boundedContextAccess,
      async integrationReady(
        ...args: Parameters<typeof actual.boundedContextAccess.integrationReady>
      ) {
        await activationGate.onIntegration?.(args[0].name.value);
        return actual.boundedContextAccess.integrationReady(...args);
      },
      async activate(...args: Parameters<typeof actual.boundedContextAccess.activate>) {
        await activationGate.onActivate?.(args[0].name.value);
        if (activationGate.enabled && args[0].name.value === "Projects") {
          activationGate.entered.resolve(undefined);
          await activationGate.release.promise;
        }
        return actual.boundedContextAccess.activate(...args);
      },
    },
  };
});

it("allows an early integration callback to publish through a later ThirdParty broker", async () => {
  const external = ThirdPartyContext.singleTenant("Calendar");
  const published: string[] = [];
  activationGate.onIntegration = async (name) => {
    if (name !== "Projects") return;
    await external.emittedEvent(
      create(ProjectCreatedSchema, { id: "early", name: "Created" }),
      create(UserIdSchema, { value: "actor" }),
    );
    published.push(name);
  };
  try {
    const application = await Application.newBuilder()
      .setServerEnvironment(
        ServerEnvironment.newBuilder()
          .under(EnvironmentType.Local, (setting) => {
            setting.use({ typeRegistry: new TypeRegistry([ProjectCreatedSchema]) });
          })
          .build(),
      )
      .add(BoundedContext.singleTenant("Projects"))
      .add(external)
      .build();
    expect(published).toEqual(["Projects"]);
    await application.close();
  } finally {
    activationGate.onIntegration = undefined;
  }
});

it("attaches a ThirdParty declaration before activation and closes it after failed activation", async () => {
  const external = ThirdPartyContext.singleTenant("Calendar");
  activationGate.onActivate = async (name) => {
    if (name !== "Projects") return;
    await external.emittedEvent(
      create(ProjectCreatedSchema, { id: "project-1", name: "Created" }),
      create(UserIdSchema, { value: "actor" }),
    );
    throw new Error("activation failed after import");
  };
  const builder = Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({ typeRegistry: new TypeRegistry([ProjectCreatedSchema]) });
        })
        .build(),
    )
    .add(BoundedContext.singleTenant("Projects"))
    .add(external);
  try {
    await expect(builder.build()).rejects.toThrow(/activation failed after import/);
    expect(external.isOpen()).toBe(false);
    await expect(
      external.emittedEvent(
        create(ProjectCreatedSchema, { id: "after", name: "Closed" }),
        create(UserIdSchema, { value: "actor" }),
      ),
    ).rejects.toThrow(/closed/);
  } finally {
    activationGate.onActivate = undefined;
  }
});

class ProjectOverview extends Projection<string, typeof ProjectOverviewStateSchema> {}

class RecoveryReader extends ProcessManager<string, typeof ProcessManagerStateSchema> {
  static names: string[] = [];

  async assign(command: CreateReviewProject): Promise<ProjectCreated> {
    const projects = await this.select(ProjectOverviewStateSchema, {}).byId(command.id).read();
    RecoveryReader.names.push(projects[0]?.name ?? "missing");
    return create(ProjectCreatedSchema, { id: command.id, name: "Recovered" });
  }
}

function environment(factory: InMemoryStorageFactory): ServerEnvironment {
  return ServerEnvironment.newBuilder()
    .under(EnvironmentType.Local, (setting) => {
      setting.use({ storageFactory: factory });
    })
    .build();
}

it("lets the first recovered handler query a later Bounded Context", async () => {
  const backend = new InMemoryStorageBackend();
  const first = await Application.newBuilder()
    .setServerEnvironment(environment(new InMemoryStorageFactory(backend)))
    .add(
      BoundedContext.singleTenant("Projects").add(
        new Repository({
          entityType: ProjectOverview,
          schema: ProjectOverviewStateSchema,
        }),
      ),
    )
    .build();
  const projects = first.contexts()[0];
  if (projects === undefined) throw new Error("Expected Projects Bounded Context.");
  await projects
    .stand()
    .update(
      ProjectOverviewStateSchema,
      create(ProjectOverviewStateSchema, { id: "project-1", name: "Ready", priority: 1 }),
    );
  await first.close();

  const inboxStorage = new InboxStorage({
    context: { name: "__System_Delivery__", multitenant: false },
    storageFactory: new InMemoryStorageFactory(backend),
  });
  const command = create(CommandSchema, {
    id: create(CommandIdSchema, { uuid: "retained-project-1" }),
    context: create(CommandContextSchema, {
      actorContext: create(ActorContextSchema, {
        actor: create(UserIdSchema, { value: "reader" }),
        timestamp: create(TimestampSchema, { seconds: 1n }),
      }),
    }),
    message: AnyPacker.pack(
      CreateReviewProjectSchema,
      create(CreateReviewProjectSchema, { id: "project-1", name: "Review" }),
    ),
  });
  const written = await new Inbox(inboxStorage).receive({
    inboxId: {
      targetTypeUrl: TypeUrls.derive(ProcessManagerStateSchema),
      targetId: Identifiers.pack("string", "project-1"),
    },
    signalId: "retained-project-1",
    label: "HANDLE_COMMAND",
    signal: AnyPacker.pack(CommandSchema, command),
    shard: ShardIndex.single(),
    status: "TO_DELIVER",
    whenReceived: create(TimestampSchema, { seconds: 1n }),
    version: 1n,
  });
  expect(written.outcome).toBe("WRITTEN");
  await inboxStorage.close();

  RecoveryReader.names = [];
  activationGate.enabled = true;
  const secondFactory = new InMemoryStorageFactory(backend);
  const secondEnvironment = environment(secondFactory);
  const building = Application.newBuilder()
    .setServerEnvironment(secondEnvironment)
    .add(
      BoundedContext.singleTenant("Workflows").add(
        new Repository({
          entityType: RecoveryReader,
          schema: ProcessManagerStateSchema,
          handlers: HandlerMetadataValues.defineArity(
            RecoveryReader,
            ProcessManagerStateSchema,
            (builder) => [builder.assign(CreateReviewProjectSchema, "assign")],
            [
              {
                kind: "command-assignment",
                methodName: "assign",
                parameterCount: 1,
                origin: "domestic",
                outcomes: { returned: [ProjectCreatedSchema], thrown: [] },
              },
            ],
          ),
          events: [ProjectCreatedSchema],
        }),
      ),
    )
    .add(
      BoundedContext.singleTenant("Projects").add(
        new Repository({
          entityType: ProjectOverview,
          schema: ProjectOverviewStateSchema,
        }),
      ),
    )
    .build();
  await activationGate.entered.promise;
  try {
    await vi.waitFor(() => {
      expect(RecoveryReader.names).toEqual(["Ready"]);
    });
  } finally {
    activationGate.release.resolve(undefined);
  }
  const second = await building;
  try {
    await serverEnvironmentAccess.whenDeliveryIdle(secondEnvironment);
    expect(RecoveryReader.names).toEqual(["Ready"]);
  } finally {
    await second.close();
  }
});
