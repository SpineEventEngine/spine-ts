/*
 * Copyright 2026, CodeMatters. All rights reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from "vitest";

import { DatastoreDeliveryCleanupStorage } from "../src/datastore/delivery-cleanup.js";

describe("DatastoreDeliveryCleanupStorage", () => {
  it("is available as the provider-owned exact-cleanup coordinator", () => {
    expect(DatastoreDeliveryCleanupStorage).toBeTypeOf("function");
  });
});
