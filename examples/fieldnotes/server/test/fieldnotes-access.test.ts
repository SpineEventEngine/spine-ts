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
import type { IncomingRequest } from "@spine-event-engine/auth";
import { AnyPacker } from "@spine-event-engine/core";
import { UserIdSchema } from "@spine-event-engine/proto";
import { TargetSchema, type Target } from "@spine-event-engine/proto/client";
import { PlaceIdSchema } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/types_pb.js";
import { PlaceViewQuery } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/entities_query.js";
import { describe, expect, it } from "vitest";
import { FieldnotesAccess } from "../src/fieldnotes-access.js";

describe("Fieldnotes gateway access", () => {
  it("requires the verified author predicate before every PlaceView query", async () => {
    const policy = new FieldnotesAccess();
    const principal = { id: "author-a" };
    const id = create(PlaceIdSchema, { value: "mixed-place" });
    const authorize = (target: Target | undefined) =>
      policy.authorize(principal, {
        kind: "query",
        target,
        requestedContext: {},
      } as IncomingRequest);
    expect(await authorize(PlaceViewQuery.create().build().build().target)).toBe(false);
    expect(await authorize(PlaceViewQuery.create().byId(id).build().build().target)).toBe(false);
    expect(
      await authorize(
        PlaceViewQuery.create()
          .author()
          .is(create(UserIdSchema, { value: "author-b" }))
          .build()
          .build().target,
      ),
    ).toBe(false);
    expect(
      await authorize(
        PlaceViewQuery.create()
          .author()
          .is(create(UserIdSchema, { value: "author-a" }))
          .build()
          .build().target,
      ),
    ).toBe(true);
    expect(
      await authorize(
        PlaceViewQuery.create()
          .author()
          .is(create(UserIdSchema, { value: "author-a" }))
          .byId(id)
          .build()
          .build().target,
      ),
    ).toBe(true);
  });

  it("admits only generated active author pages with a descending creation-time cursor", async () => {
    const policy = new FieldnotesAccess();
    const author = create(UserIdSchema, { value: "author-a" });
    const foreign = create(UserIdSchema, { value: "author-b" });
    const cursor = create(TimestampSchema, { seconds: 100n, nanos: 23 });
    const admitted = (target: Target | undefined) =>
      policy.authorize({ id: author.value }, {
        kind: "query",
        target,
        requestedContext: {},
      } as IncomingRequest);
    const target = (query: ReturnType<typeof PlaceViewQuery.create>) =>
      query.build().build().target;
    expect(
      await admitted(target(PlaceViewQuery.create().author().is(author).removed().is(false))),
    ).toBe(true);
    expect(
      await admitted(
        target(
          PlaceViewQuery.create()
            .author()
            .is(author)
            .removed()
            .is(false)
            .whenCreated()
            .isLessThan(cursor),
        ),
      ),
    ).toBe(true);
    expect(
      await admitted(
        target(
          PlaceViewQuery.create()
            .author()
            .is(foreign)
            .removed()
            .is(false)
            .whenCreated()
            .isLessThan(cursor),
        ),
      ),
    ).toBe(false);
    expect(
      await admitted(
        target(
          PlaceViewQuery.create()
            .author()
            .is(author)
            .removed()
            .is(false)
            .whenCreated()
            .isGreaterThan(cursor),
        ),
      ),
    ).toBe(false);
    expect(
      await admitted(
        target(
          PlaceViewQuery.create().author().is(author).removed().is(false).whenCreated().is(cursor),
        ),
      ),
    ).toBe(false);
    expect(
      await admitted(
        target(
          PlaceViewQuery.create()
            .author()
            .is(author)
            .removed()
            .is(false)
            .name()
            .is("extra")
            .whenCreated()
            .isLessThan(cursor),
        ),
      ),
    ).toBe(false);
    expect(
      await admitted(
        target(
          PlaceViewQuery.create()
            .either(
              (query) => {
                query.author().is(author);
              },
              (query) => {
                query.author().is(foreign);
              },
            )
            .removed()
            .is(false)
            .whenCreated()
            .isLessThan(cursor),
        ),
      ),
    ).toBe(false);
    const stringCursor = target(
      PlaceViewQuery.create()
        .author()
        .is(author)
        .removed()
        .is(false)
        .whenCreated()
        .isLessThan(cursor),
    );
    if (stringCursor?.criterion.case !== "filters")
      throw new Error("Expected canonical creation-time cursor target.");
    const operand = stringCursor.criterion.value.filter[2]?.filter[0];
    if (operand === undefined) throw new Error("Expected creation-time cursor operand.");
    operand.value = AnyPacker.pack(
      StringValueSchema,
      create(StringValueSchema, { value: "not-a-timestamp" }),
    );
    expect(await admitted(stringCursor)).toBe(false);
  });
  it("admits only the canonical author entity topic", async () => {
    const policy = new FieldnotesAccess();
    const principal = { id: "author-a" };
    const target = PlaceViewQuery.create()
      .author()
      .is(create(UserIdSchema, { value: principal.id }))
      .build()
      .build().target;
    const subscribe = (selected: typeof target) =>
      ({
        kind: "subscribe",
        target: selected,
        requestedContext: {},
      }) as IncomingRequest;
    expect(await policy.authorize(principal, subscribe(target))).toBe(true);
    expect(
      await policy.authorize(principal, subscribe(PlaceViewQuery.create().build().build().target)),
    ).toBe(false);
    expect(
      await policy.authorize(
        principal,
        subscribe(
          PlaceViewQuery.create()
            .author()
            .is(create(UserIdSchema, { value: "author-b" }))
            .build()
            .build().target,
        ),
      ),
    ).toBe(false);
    expect(
      await policy.authorize(
        principal,
        subscribe(
          PlaceViewQuery.create()
            .author()
            .is(create(UserIdSchema, { value: principal.id }))
            .removed()
            .is(false)
            .build()
            .build().target,
        ),
      ),
    ).toBe(false);
    expect(await policy.authorize(principal, subscribe(create(TargetSchema)))).toBe(false);
  });
});
