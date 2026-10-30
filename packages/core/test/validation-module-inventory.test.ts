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
import { describe, expect, it } from "vitest";
import "../test-fixtures/generated/proto-module.js";
import { ProjectCriteriaSchema } from "../test-fixtures/generated/criteria_types_pb.js";
import { FindProjectsSchema } from "../test-fixtures/generated/project_types_pb.js";
import { AnyPacker, Validate } from "../src/index.js";

describe("registered module validation", () => {
  it("validates an annotated application Any without a caller-supplied registry", () => {
    const query = create(FindProjectsSchema, {
      criteria: AnyPacker.pack(ProjectCriteriaSchema, create(ProjectCriteriaSchema)),
      projectId: ["project-1"],
      tags: { team: "platform" },
    });

    expect(
      Validate.message(FindProjectsSchema, query).violations.map(
        (violation) => violation.fieldPath?.fieldName,
      ),
    ).toEqual([["criteria", "keyword"]]);
  });
});
