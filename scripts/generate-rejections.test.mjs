import { describe, expect, it } from "vitest";

import { generateRejectionCompanions, rejectionMessages } from "./generate-rejections.mjs";

function generatedOutput() {
  const imports = [];
  const printed = [];

  return {
    exports: [],
    imports,
    printed,
    export(_declaration, name) {
      this.exports.push(name);
      return `export const ${name}`;
    },
    import(name, from, typeOnly = false) {
      const symbol = { from, name, typeOnly };
      imports.push(symbol);
      return name;
    },
    importSchema(message) {
      const symbol = { from: "./task_rejections_pb.js", name: `${message.name}Schema` };
      imports.push(symbol);
      return symbol.name;
    },
    preamble() {},
    print(...parts) {
      printed.push(parts);
    },
  };
}

describe("rejection companion generator", () => {
  it("keeps delivery-server rejection runtime helpers private", () => {
    expect(
      rejectionMessages({
        name: "spine/delivery/rejections.proto",
        messages: [{ name: "ShardAlreadyPickedUp" }],
      }),
    ).toEqual([]);
  });

  it("emits a same-directory companion for only top-level rejection messages", () => {
    const output = generatedOutput();
    const generatedFiles = [];

    generateRejectionCompanions({
      files: [
        {
          name: "spine/example/todo/v1/task_rejections",
          proto: { name: "spine/example/todo/v1/task_rejections.proto" },
          messages: [
            { name: "TaskAlreadyDone" },
            { name: "NestedRejection", parent: { name: "Container" } },
          ],
        },
        {
          name: "spine/example/todo/v1/task_events",
          proto: { name: "spine/example/todo/v1/task_events.proto" },
          messages: [{ name: "NotARejection" }],
        },
      ],
      generateFile(name) {
        generatedFiles.push(name);
        return output;
      },
    });

    expect(generatedFiles).toEqual(["spine/example/todo/v1/task_rejections.ts"]);
    expect(output.exports).toEqual(["TaskAlreadyDone"]);
    expect(output.exports).not.toContain("NestedRejection");
    expect(output.imports).toContainEqual({
      from: "./task_rejections_pb.js",
      name: "TaskAlreadyDoneSchema",
    });
    expect(output.imports).toContainEqual({
      from: "@spine-ts/core",
      name: "createRejectionThrowable",
      typeOnly: false,
    });
    expect(output.printed.flat().join("")).toContain("MessageInitShape");
  });
});
