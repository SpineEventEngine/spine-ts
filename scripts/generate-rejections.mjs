#!/usr/bin/env node
import { createEcmaScriptPlugin, runNodeJs } from "@bufbuild/protoplugin";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { generateRejectionCompanions } from "../packages/proto-tools/src/generation/rejection-generator.ts";

const rejectionPlugin = createEcmaScriptPlugin({
  name: "protoc-gen-spine-rejections",
  version: "1.0.0",
  generateTs: generateRejectionCompanions,
});

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runNodeJs(rejectionPlugin);
