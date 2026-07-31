import { createEcmaScriptPlugin, getComments, runNodeJs, type Schema } from "@bufbuild/protoplugin";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/**
 * Generates typed throwable companions for top-level owned rejection messages.
 */
export function generateRejectionCompanions(schema: Schema): void {
  for (const file of schema.files) {
    if (
      !file.proto.name.endsWith("rejections.proto") ||
      file.proto.name.startsWith("spine/delivery/")
    )
      continue;
    const messages = file.messages.filter((message) => message.parent === undefined);
    if (messages.length === 0) continue;
    const output = schema.generateFile(`${file.name}.ts`);
    const throwable = output.import("RejectionThrowable", "@spine-event-engine/core");
    const messageInit = output.import("MessageInitShape", "@bufbuild/protobuf", true);
    output.preamble(file);
    for (const message of messages) {
      const messageSchema = output.importSchema(message);
      output.print(
        rejectionTSDoc(getComments(message).leading),
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
        throwable,
        ".create(",
        messageSchema,
        ", input);\n  },\n};\n",
      );
    }
  }
}

/**
 * Renders a leading Proto comment as deterministic TypeScript documentation.
 */
export function rejectionTSDoc(comment: string | undefined): string {
  const lines = (comment ?? "Creates this rejection throwable.")
    .replaceAll("*/", "*&#47;")
    .split(/\r?\n/u)
    .map((line) =>
      line
        .trim()
        .replace(/^\/\/\s?/u, "")
        .replace(/^@/u, "\\@"),
    )
    .filter(Boolean);
  return `/**\n * ${lines.join(" ") || "Creates this rejection throwable."}\n */\n`;
}

const rejectionPlugin = createEcmaScriptPlugin({
  name: "protoc-gen-spine-rejections",
  version: "1.0.0",
  generateTs: generateRejectionCompanions,
});

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runNodeJs(rejectionPlugin);
