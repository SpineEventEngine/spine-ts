#!/usr/bin/env node
import { resolve } from "node:path";

import { composeApplication, generateHandlers, generateModel } from "../generation/generator.js";

const root = resolve(process.cwd());
const command = process.argv[2] ?? "generate";
if (command === "generate") {
  generateModel(root);
} else if (command === "compose") {
  composeApplication(root);
} else if (command === "handlers") {
  generateHandlers(root);
} else {
  throw new Error(`spine-proto: unsupported command ${command}`);
}
