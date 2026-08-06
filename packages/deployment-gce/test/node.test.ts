import { describe, expect, it } from "vitest";
import { GceApplicationNode } from "../src/index.js";

describe("GceApplicationNode", () => {
  it("derives a stable private node and preserves canonical overrides", () => {
    expect(GceApplicationNode.create({ projectId: "project", zone: "zone", instanceId: "42", privateAddress: "fd00::1" }, { port: 8080, endpoint: "https://Api.Example.Test", tlsServerName: "Api.Example.Test" })).toMatchObject({ id: "gce/project/zone/42", endpoint: "https://api.example.test", tlsServerName: "api.example.test" });
  });
});
