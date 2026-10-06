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
import { StringValueSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AnyMessages } from "@spine-event-engine/core";
import { Time } from "@spine-event-engine/core/time";
import {
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  VersionSchema,
} from "@spine-event-engine/proto";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { expect, it } from "vitest";

import {
  BoundedContext,
  EntityHandlers,
  EventRouting,
  ProcessManager,
  Repository,
} from "../../src/index.js";
import {
  ProjectCreatedSchema,
  type ProjectCreated,
} from "../../test-fixtures/generated/repository-routing/project_events_pb.js";
import { ProjectQueueStateSchema } from "../../test-fixtures/generated/repository-routing/project_states_pb.js";

class RoutedQueue extends ProcessManager<string, typeof ProjectQueueStateSchema> {
  static readonly calls = new Map<string, number>();

  react(event: ProjectCreated): undefined {
    RoutedQueue.calls.set(this.id, (RoutedQueue.calls.get(this.id) ?? 0) + 1);
    this.update((draft) =>
      Object.assign(draft, {
        id: this.id,
        queue: event.name,
      }),
    );
    return undefined;
  }
}

async function startCpuProfile(
  label: string,
): Promise<((start: number, end: number) => Promise<void>) | undefined> {
  const directory = process.env.SPINE_ENTITY_DELIVERY_PROFILE_DIR;
  if (directory === undefined) return undefined;
  if (directory !== "/tmp" && !directory.startsWith("/tmp/")) {
    throw new Error("SPINE_ENTITY_DELIVERY_PROFILE_DIR must name an absolute /tmp directory");
  }
  const [fs, path, inspector] = await Promise.all([
    import("node:fs/promises"),
    import("node:path"),
    import("node:inspector/promises"),
  ]);
  await fs.mkdir(directory, { recursive: true });
  const session = new inspector.Session();
  session.connect();
  try {
    await session.post("Profiler.enable");
    await session.post("Profiler.start");
  } catch (error) {
    session.disconnect();
    throw error;
  }
  const profileOrigin = Time.monotonicTime();
  return async (start, end) => {
    try {
      const { profile } = await session.post("Profiler.stop");
      const startMicros = profile.startTime + (start - profileOrigin) * 1_000;
      const endMicros = profile.startTime + (end - profileOrigin) * 1_000;
      const samples: number[] = [];
      const timeDeltas: number[] = [];
      const hitCounts = new Map<number, number>();
      const rawSamples = profile.samples ?? [];
      const rawDeltas = profile.timeDeltas ?? [];
      let previous = profile.startTime;
      for (let index = 0; index < rawSamples.length; index++) {
        const current = previous + (rawDeltas[index] ?? 0);
        const overlap = Math.min(current, endMicros) - Math.max(previous, startMicros);
        if (overlap > 0) {
          const sample = rawSamples[index];
          if (sample === undefined) throw new Error("CPU profile sample is missing");
          samples.push(sample);
          timeDeltas.push(overlap);
          hitCounts.set(sample, (hitCounts.get(sample) ?? 0) + 1);
        }
        previous = current;
      }
      profile.startTime = startMicros;
      profile.endTime = endMicros;
      profile.samples = samples;
      profile.timeDeltas = timeDeltas;
      for (const node of profile.nodes) node.hitCount = hitCounts.get(node.id) ?? 0;
      await fs.writeFile(
        path.join(directory, `entity-delivery-${String(process.pid)}-${label}.cpuprofile`),
        JSON.stringify(profile),
      );
    } finally {
      session.disconnect();
    }
  };
}

async function measure(count: number, label: string): Promise<number> {
  const ids = Array.from({ length: count }, (_, index) => `queue-${String(index)}`);
  const handlers = EntityHandlers.define(RoutedQueue, ProjectQueueStateSchema, (builder) => [
    builder.react(ProjectCreatedSchema, "react"),
  ]);
  const repository = new Repository({
    entityType: RoutedQueue,
    schema: ProjectQueueStateSchema,
    handlers,
    eventRouting: EventRouting.create(RoutedQueue).route(ProjectCreatedSchema, () => ids),
  });
  const context = BoundedContext.singleTenant(`DeliveryBenchmark${String(count)}`)
    .add(repository)
    .withStorageFactory(new InMemoryStorageFactory())
    .build();
  const event = create(EventSchema, {
    id: create(EventIdSchema, { value: "queue-created" }),
    context: create(EventContextSchema, {
      producerId: AnyMessages.pack(
        StringValueSchema,
        create(StringValueSchema, { value: "source" }),
      ),
      timestamp: create(TimestampSchema, { seconds: 1n }),
      version: create(VersionSchema, { number: 1 }),
    }),
    message: AnyMessages.pack(
      ProjectCreatedSchema,
      create(ProjectCreatedSchema, {
        id: "source",
        name: "routed",
        priority: 1,
      }),
    ),
  });
  try {
    RoutedQueue.calls.clear();
    const stopCpuProfile =
      process.env.SPINE_ENTITY_DELIVERY_PROFILE_DIR === undefined
        ? undefined
        : await startCpuProfile(label);
    let elapsed = 0;
    const start = Time.monotonicTime();
    try {
      await context.eventBus().post(event);
    } finally {
      const end = Time.monotonicTime();
      elapsed = end - start;
      if (stopCpuProfile) await stopCpuProfile(start, end);
    }
    for (const id of ids) {
      expect(await context.stand().read(ProjectQueueStateSchema, id)).toMatchObject({
        id,
        queue: "routed",
      });
      expect(RoutedQueue.calls.get(id)).toBe(1);
    }
    expect(RoutedQueue.calls.size).toBe(count);
    return elapsed;
  } finally {
    await context.close();
  }
}

it.skipIf(process.env.SPINE_ENTITY_DELIVERY_BENCH !== "1")(
  "measures real Process Manager delivery with fresh in-memory contexts",
  async () => {
    const warmup = await measure(1_000, "warmup");
    const hundred = await measure(100, "hundred");
    const fiveHundred = await measure(500, "five-hundred");
    const thousand = [];
    for (let run = 0; run < 5; run++) {
      thousand.push(await measure(1_000, `thousand-${String(run + 1)}`));
    }
    process.stderr.write(`${JSON.stringify({ warmup, hundred, fiveHundred, thousand })}\n`);
    for (const elapsed of thousand) expect(elapsed).toBeLessThan(1_000);
  },
  120_000,
);
