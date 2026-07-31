#!/usr/bin/env node
import { resolve } from "node:path";

import { ProtoGeneration } from "../generation/generator.js";
import "../generation/rejection-generator.js";

const root = resolve(process.cwd());
const command = process.argv[2] ?? "generate";
if (command === "generate") {
  ProtoGeneration.generate(root);
} else if (command === "compose") {
  ProtoGeneration.compose(root);
} else {
  throw new Error(`spine-proto bootstrap: unsupported command ${command}`);
}
