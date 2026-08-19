// Removes only this example's generated build output before a fresh TypeScript build.

import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const todoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

rmSync(join(todoRoot, "dist/generated"), { recursive: true, force: true });
rmSync(join(todoRoot, "dist/tsconfig.tsbuildinfo"), { force: true });
