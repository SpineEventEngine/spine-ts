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

import { GceApplicationNode } from "../../src/index.js";

describe("GceApplicationNode", () => {
  it("derives a stable private node and preserves canonical overrides", () => {
    expect(
      GceApplicationNode.create(
        { projectId: "project", zone: "zone", instanceId: "42", privateAddress: "fd00::1" },
        { port: 8080, endpoint: "https://Api.Example.Test", tlsServerName: "Api.Example.Test" },
      ),
    ).toMatchObject({
      id: "gce/project/zone/42",
      endpoint: "https://api.example.test",
      tlsServerName: "api.example.test",
    });
  });

  it("uses bracketed private IPv6 defaults and fences numeric instance identities", () => {
    expect(
      GceApplicationNode.create(
        { projectId: "p", zone: "z", instanceId: "2", privateAddress: "fd00::1" },
        { port: 8080 },
      ),
    ).toMatchObject({ id: "gce/p/z/2", endpoint: "http://[fd00::1]:8080" });
    expect(() =>
      GceApplicationNode.create(
        { projectId: "p", zone: "z", instanceId: "label", privateAddress: "10.0.0.1" },
        { port: 0 },
      ),
    ).toThrow();
  });

  it("lets an explicit canonical HTTPS override win and rejects invalid endpoint inputs", () => {
    const metadata = { projectId: "p", zone: "z", instanceId: "1", privateAddress: "10.0.0.1" };
    expect(
      GceApplicationNode.create(metadata, {
        port: 8080,
        endpoint: "https://API.Example.Test",
        tlsServerName: "Api.Example.Test",
      }),
    ).toMatchObject({ endpoint: "https://api.example.test", tlsServerName: "api.example.test" });
    expect(() =>
      GceApplicationNode.create(metadata, {
        port: 8080,
        endpoint: "http://10.0.0.1",
        tlsServerName: "api.test",
      }),
    ).toThrow("TLS");
    expect(() =>
      GceApplicationNode.create(metadata, { port: 8080, endpoint: "https://user@api.test/path" }),
    ).toThrow("endpoint");
    expect(() =>
      GceApplicationNode.create(metadata, { port: 8080, endpoint: "ftp://api.test" }),
    ).toThrow("endpoint");
  });

  it("uses the numeric GCE instance identity to distinguish restarts", () => {
    const base = { projectId: "p", zone: "z", privateAddress: "10.0.0.1" };
    expect(GceApplicationNode.create({ ...base, instanceId: "1" }, { port: 8080 }).id).not.toBe(
      GceApplicationNode.create({ ...base, instanceId: "2" }, { port: 8080 }).id,
    );
  });
});
