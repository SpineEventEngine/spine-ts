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

import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { BlackBox } from "@spine-event-engine/testing";
import { CreateProjectSchema } from "../generated/spine/server/testing/project_commands_pb.js";
import { ProjectCreatedSchema } from "../generated/spine/server/testing/project_events_pb.js";
import {
  PlanningStateSchema,
  StaffingStateSchema,
} from "../generated/spine/server/testing/project_workflow_pb.js";
import { projectWorkflow, projectWorkflowIds } from "../test-fixtures/project-workflow.js";

describe("Project process fixture", () => {
  it("routes one committed ProjectCreated to real planning, staffing and projection states", async () => {
    const entries: string[] = [];
    const ids = projectWorkflowIds("fixture-test", 1);
    const blackBox = await BlackBox.from(
      projectWorkflow("fixture-test", (entry) => entries.push(entry.method)),
    );
    try {
      const result = await blackBox
        .asGuest()
        .post(
          CreateProjectSchema,
          create(CreateProjectSchema, { project: ids.project, name: "roadmap" }),
        );
      expect(result.kind).toBe("ok");
      const events = await blackBox.eventually(
        () => blackBox.assertEvents(),
        (candidate) => candidate.length >= 1,
      );
      expect(events[0]?.message?.typeUrl).toContain(ProjectCreatedSchema.typeName);
      await blackBox.eventually(
        () => entries.length,
        (count) => count >= 5,
      );
      expect(entries).toEqual(
        expect.arrayContaining(["create", "planning", "staffing", "portfolio", "projection"]),
      );
    } finally {
      await blackBox.close();
    }
  });

  it("derives distinct recipient IDs for two ProjectCreated Events", async () => {
    const entries: string[] = [];
    const context = projectWorkflow("two-projects", (entry) => entries.push(entry.correlation));
    const first = projectWorkflowIds("fixture-pair", 1);
    const second = projectWorkflowIds("fixture-pair", 2);
    const blackBox = await BlackBox.from(context);
    try {
      for (const ids of [first, second]) {
        const result = await blackBox
          .asGuest()
          .post(
            CreateProjectSchema,
            create(CreateProjectSchema, {
              project: ids.project,
              name: `roadmap-${ids.project.number}`,
            }),
          );
        expect(result.kind).toBe("ok");
      }
      await blackBox.eventually(
        async () =>
          Promise.all([
            context.stand().read(PlanningStateSchema, first.planning),
            context.stand().read(PlanningStateSchema, second.planning),
            context.stand().read(StaffingStateSchema, first.staffing),
            context.stand().read(StaffingStateSchema, second.staffing),
          ]),
        (states) => states.every((state) => state !== undefined),
      );
      await blackBox.eventually(
        () => entries.length,
        (length) => length === 10,
      );
      expect(entries.filter((value) => value === "fixture-pair:1")).toHaveLength(5);
      expect(entries.filter((value) => value === "fixture-pair:2")).toHaveLength(5);
    } finally {
      await blackBox.close();
    }
  });
});
