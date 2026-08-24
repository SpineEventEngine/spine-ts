import { describe, expect, it } from "vitest";

import { main, prepareRelease } from "./release-cli.mjs";
import { frameworkPackageNames } from "./package-artifacts.mjs";

describe("release CLI", () => {
  it("rejects publication outside the exact official Actions push context", async () => {
    await expect(main({ argv: ["node", "cli", "publish"], environment: {} })).rejects.toThrow(
      "permitted only",
    );
  });

  it("packs once, proves the exact returned list, and cleans check output", () => {
    const removed = [];
    const expected = {
      tag: "snapshot",
      version: "2.0.0-snapshot.4",
      packages: frameworkPackageNames
        .map((name) => ({ name, dependencies: [] }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
    const packages = expected.packages.map(({ name }, index) => ({
      name,
      tarball: "/tmp/release/" + index + ".tgz",
      integrity: "sha512-YQ==",
      dependencies: [],
    }));
    prepareRelease({
      root: "root",
      check: true,
      mkdtemp: () => "/tmp/release",
      exists: () => false,
      mkdir: () => {},
      remove: (path) => removed.push(path),
      pack: () => packages,
      prove: ({ packages: actual }) => expect(actual).toBe(packages),
      writeManifest: () => {},
      expected,
    });
    expect(removed).toEqual(["/tmp/release"]);
  });

  it("does not delete an existing explicit output", () => {
    expect(() => prepareRelease({ output: "/existing", exists: () => true })).toThrow(
      "already exists",
    );
  });

  it.each(["pack", "prove", "write"])("removes owned output when %s fails", (phase) => {
    const removed = [];
    expect(() =>
      prepareRelease({
        output: "/owned",
        exists: () => false,
        mkdir: () => {},
        remove: (path) => removed.push(path),
        pack: () => {
          throw new Error(phase);
        },
      }),
    ).toThrow(phase);
    expect(removed).toEqual(["/owned"]);
  });

  it.each(["SIGINT", "SIGTERM"])("cleans owned output for %s", (signal) => {
    const handlers = new Map();
    const removed = [];
    expect(() =>
      prepareRelease({
        output: "/owned",
        exists: () => false,
        mkdir: () => {},
        remove: (path) => removed.push(path),
        pack: () => {
          throw new Error("stop");
        },
        registerSignal: (name, handler) => {
          handlers.set(name, handler);
          return () => {};
        },
        exit: () => {},
      }),
    ).toThrow("stop");
    expect(handlers.has(signal)).toBe(true);
  });

  it("rejects prepare without an output mode", async () => {
    await expect(main({ argv: ["node", "cli", "prepare"], environment: {} })).rejects.toThrow(
      "requires --check or --output",
    );
  });
});
