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

import {
  DeliveryServer,
  InMemoryDelivery,
  type DeliveryCore,
  type DeliveryCoreOptions,
  type DeliveryServerOptions,
} from "../src/index.js";

describe("InMemoryDelivery", () => {
  it("creates an isolated core with only Inbox and Shard handler seams", () => {
    const options: DeliveryCoreOptions = {};
    const core: DeliveryCore = InMemoryDelivery.create(options);

    expect(core.inbox).toBeDefined();
    expect(core.shards).toBeDefined();
    expect("close" in core).toBe(false);
  });
});

describe("DeliveryServer public API", () => {
  it("exposes the standalone lifecycle class without internal listener details", () => {
    const options: DeliveryServerOptions = { port: 0 };
    const server = new DeliveryServer(options);
    expect(server.port).toBe(0);
    expect("server" in server).toBe(false);
  });
});
