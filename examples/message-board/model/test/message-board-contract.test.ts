import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("MessageBoard PostMessage contract", () => {
  it("declares server-authored required messages for username and text", async () => {
    const source = await readFile(
      new URL("../proto/spine/examples/messageboard/commands.proto", import.meta.url),
      "utf8",
    );

    expect(source).toContain("package spine.examples.messageboard;");
    expect(source).toContain(
      'string username = 4 [(required) = true, (if_missing).error_msg = "Enter a username."];',
    );
    expect(source).toContain(
      'string text = 5 [(required) = true, (if_missing).error_msg = "Enter a message."];',
    );
  });
});
