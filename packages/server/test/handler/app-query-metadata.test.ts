/*
 * Copyright 2026, CodeMatters. All rights reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at https://www.apache.org/licenses/LICENSE-2.0
 */

import type {
  GetProjectOverview_Query,
  GetProjectOverview_Response,
} from "../../test-fixtures/generated/repository-routing/project_queries_pb.js";
import {
  GetProjectOverview_QuerySchema,
  GetProjectOverview_ResponseSchema,
} from "../../test-fixtures/generated/repository-routing/project_queries_pb.js";
import { afterEach, describe, expect, it } from "vitest";
import { AppQueryHandler, type AppQueryContext } from "../../src/handler/app-query-handler.js";
import {
  registerSpineMetadata,
  SpineMetadataInventory,
  spineMetadataTestAccess,
} from "../../src/handler/spine-metadata-inventory.js";

class FirstOverview extends AppQueryHandler<GetProjectOverview_Query, GetProjectOverview_Response> {
  execute(
    _query: GetProjectOverview_Query,
    _context: AppQueryContext,
  ): GetProjectOverview_Response {
    void _query;
    void _context;
    throw new Error("not executed by metadata registration");
  }
}

class SecondOverview extends AppQueryHandler<
  GetProjectOverview_Query,
  GetProjectOverview_Response
> {
  execute(
    _query: GetProjectOverview_Query,
    _context: AppQueryContext,
  ): GetProjectOverview_Response {
    void _query;
    void _context;
    throw new Error("not executed by metadata registration");
  }
}

const first = {
  handlerType: FirstOverview,
  queryTypeName: "repository_routing.GetProjectOverview.Query",
  querySchema: GetProjectOverview_QuerySchema,
  responseSchema: GetProjectOverview_ResponseSchema,
};

afterEach(() => {
  spineMetadataTestAccess.clear();
});

describe("passive App Query metadata", () => {
  it("retains multiple implementations by exact constructor without activating either", () => {
    const second = { ...first, handlerType: SecondOverview };
    registerSpineMetadata({ receivers: [], appQueries: [first, second] }, "test:project-queries");
    expect(SpineMetadataInventory.selectQueries([SecondOverview, FirstOverview])).toEqual([
      second,
      first,
    ]);
  });

  it("rejects an inconsistent result schema before publishing metadata", () => {
    expect(() => {
      registerSpineMetadata(
        {
          receivers: [],
          appQueries: [{ ...first, responseSchema: GetProjectOverview_QuerySchema }],
        },
        "test:bad-query",
      );
    }).toThrow(/Response schema/u);
    expect(() => SpineMetadataInventory.selectQueries([FirstOverview])).toThrow(/missing/u);
  });

  it("rejects conflicting modules for one constructor without replacing the first description", () => {
    registerSpineMetadata({ receivers: [], appQueries: [first] }, "test:first");
    expect(() => {
      registerSpineMetadata({ receivers: [], appQueries: [{ ...first }] }, "test:second");
    }).toThrow(/Spine App Query metadata for FirstOverview conflicts/u);
    expect(SpineMetadataInventory.selectQueries([FirstOverview])).toEqual([first]);
  });
});
