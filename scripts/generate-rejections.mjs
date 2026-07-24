#!/usr/bin/env node
import { createEcmaScriptPlugin, runNodeJs } from "@bufbuild/protoplugin";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function rejectionMessages(file) {
  return file.name.endsWith("rejections.proto") && !file.name.startsWith("spine/delivery/")
    ? file.messages.filter((message) => message.parent === undefined)
    : [];
}

export function generateRejectionCompanions(schema) {
  for (const file of schema.files) {
    const messages = rejectionMessages({ name: file.proto.name, messages: file.messages });

    if (messages.length === 0) {
      continue;
    }

    const output = schema.generateFile(`${file.name}.ts`);
    const factory = output.import("createRejectionThrowable", "@spine-event-engine/core");
    const throwable = output.import("RejectionThrowable", "@spine-event-engine/core", true);
    const messageInit = output.import("MessageInitShape", "@bufbuild/protobuf", true);

    output.preamble(file);
    for (const message of messages) {
      const messageSchema = output.importSchema(message);
      output.print(
        output.export("const", message.name),
        ": { readonly create: (input: ",
        messageInit,
        "<typeof ",
        messageSchema,
        ">) => ",
        throwable,
        "<typeof ",
        messageSchema,
        "> } = {\n  create(input) {\n    return ",
        factory,
        "(",
        messageSchema,
        ", input);\n  },\n};\n",
      );
    }
  }
}

const rejectionPlugin = createEcmaScriptPlugin({
  name: "protoc-gen-spine-rejections",
  version: "1.0.0",
  generateTs: generateRejectionCompanions,
});

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runNodeJs(rejectionPlugin);
}
