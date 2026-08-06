import { describe, expect, it } from "vitest";

import { ApplicationNode, StaticNodeDiscovery } from "../src/index.js";

describe("ApplicationNode", () => {
  it("canonicalizes a HTTPS endpoint and its TLS authority", () => {
    const node = new ApplicationNode({
      id: "node/one",
      endpoint: "https://API.Example.test:443/",
      tlsServerName: "Api.Example.Test",
    });

    expect(node.endpoint).toBe("https://api.example.test");
    expect(node.tlsServerName).toBe("api.example.test");
  });

  it("keeps bracketed IPv6 origins and rejects TLS names for HTTP", () => {
    expect(
      new ApplicationNode({ id: "node/v6", endpoint: "http://[fd00::1]:8080/" }).endpoint,
    ).toBe("http://[fd00::1]:8080");
    expect(
      () =>
        new ApplicationNode({
          id: "node/http",
          endpoint: "http://10.0.0.1",
          tlsServerName: "a.test",
        }),
    ).toThrow("TLS server names require HTTPS");
  });
});

describe("StaticNodeDiscovery", () => {
  it("publishes complete immutable snapshots including an empty one", async () => {
    const source = new StaticNodeDiscovery([]);
    const snapshots: readonly string[][] = [];
    const close = source.watch((nodes) => snapshots.push(nodes.map((node) => node.id)));

    source.replace([new ApplicationNode({ id: "node/a", endpoint: "http://10.0.0.1" })]);
    source.replace([]);
    await close();

    expect(snapshots).toEqual([[], ["node/a"], []]);
  });
});
