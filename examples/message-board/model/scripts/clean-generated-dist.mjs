// Removes model build output so the next generation starts from source files.
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

rmSync(join(packageRoot, "dist/generated"), { recursive: true, force: true });
rmSync(join(packageRoot, "dist/tsconfig.tsbuildinfo"), { force: true });
