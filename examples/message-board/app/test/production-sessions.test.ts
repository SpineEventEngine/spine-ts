import { generateKeyPairSync } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { MessageBoardDeployment } from "../src/deployment-config.js";
import { MessageBoardSessionRevocations } from "../src/session-revocations.js";

describe("MessageBoard production sessions", () => {
  it("shares signed session validation and durable revocation across processes", async () => {
    const storage = new InMemoryStorageFactory();
    const environment = productionEnvironment();
    const left = MessageBoardDeployment.sessions(storage, environment);
    const right = MessageBoardDeployment.sessions(storage, environment);
    const issued = await left.issue({ id: "message-author" });

    expect(issued.kind).toBe("issued");
    if (issued.kind !== "issued") throw new Error("Expected a signed session.");
    await expect(right.resolve(issued.credential)).resolves.toMatchObject({
      principal: { id: "message-author" },
    });
    await expect(left.logout(issued.credential)).resolves.toEqual({ kind: "revoked" });
    await expect(right.resolve(issued.credential)).resolves.toBeUndefined();

    storage.close();
    await expect(left.resolve(issued.credential)).resolves.toBeUndefined();
  });

  it("requires every shared production session setting", () => {
    const environment = productionEnvironment();
    delete environment.MESSAGE_BOARD_SESSION_PRIVATE_KEY;

    expect(() =>
      MessageBoardDeployment.sessions(new InMemoryStorageFactory(), environment),
    ).toThrow("MESSAGE_BOARD_SESSION_PRIVATE_KEY");
  });

  it("isolates revocations by namespace and discards expired records before capacity checks", async () => {
    const storage = new InMemoryStorageFactory();
    const left = new MessageBoardSessionRevocations(storage, "left");
    const right = new MessageBoardSessionRevocations(storage, "right");
    const id = "A".repeat(22);

    await left.revoke(id, create(TimestampSchema, { seconds: 0n }));

    await expect(left.isRevoked(id)).resolves.toBe(false);
    await expect(right.isRevoked(id)).resolves.toBe(false);
    await right.revoke(id, create(TimestampSchema, { seconds: 4_102_444_800n }));
    await expect(left.isRevoked(id)).resolves.toBe(false);
    await expect(right.isRevoked(id)).resolves.toBe(true);
  });
});

function productionEnvironment(): NodeJS.ProcessEnv {
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    NODE_ENV: "production",
    MESSAGE_BOARD_SESSION_ISSUER: "message-board",
    MESSAGE_BOARD_SESSION_AUDIENCE: "message-board-web",
    MESSAGE_BOARD_SESSION_KEY_ID: "message-board-2026",
    SUBSCRIPTION_REGISTRY_NAMESPACE: "message-board-production",
    MESSAGE_BOARD_SESSION_PRIVATE_KEY: key.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
  };
}
