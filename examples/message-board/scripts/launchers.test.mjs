// Verifies local launcher contracts without starting Docker or Node children.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const local = readFileSync(
  new URL("./start-local-multi-process-local-delivery.sh", import.meta.url),
  "utf8",
);

test("local managed launcher starts without an optional remote Delivery URL", () => {
  assert.match(local, /if test -n "\$\{DELIVERY_SERVER_URL:-\}"/u);
  assert.match(local, /MESSAGE_BOARD_DELIVERY_MODE="\$\{MESSAGE_BOARD_DELIVERY_MODE:-local\}"/u);
  assert.doesNotMatch(local, /delivery_environment\[@\]/u);
});
