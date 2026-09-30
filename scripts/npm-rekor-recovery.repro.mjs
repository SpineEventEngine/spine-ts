import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";

const npmRoot = join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "npm");
const npmRequire = createRequire(join(npmRoot, "package.json"));
const { EphemeralSigner } = npmRequire("@sigstore/sign/dist/signer/fulcio/ephemeral.js");
const { TLogClient } = npmRequire("@sigstore/sign/dist/witness/tlog/client.js");
const { toProposedEntry } = npmRequire("@sigstore/sign/dist/witness/tlog/entry.js");
const { getError } = npmRequire("./lib/utils/error-message.js");
const { jsonError } = npmRequire("./lib/utils/output-error.js");
const recordId = "108e9186e8c5677a245de144eb51ce7c25da7fd499317cef7acfecf9a480e3b2d7dc97903b374234";
const conflictText = `an equivalent entry already exists in the transparency log with UUID ${recordId}`;

/**
 * Creates a signed Rekor proposal using Sigstore's ephemeral signer.
 *
 * @returns A signed proposal and its public key.
 */
async function signedEntry() {
  const signer = new EphemeralSigner();
  const payload = Buffer.from("local publication evidence");
  const result = await signer.sign(payload);
  const content = {
    $case: "messageSignature",
    messageSignature: {
      messageDigest: { digest: createHash("sha256").update(payload).digest() },
      signature: result.signature,
    },
  };
  return {
    proposal: toProposedEntry(content, result.key.publicKey),
    publicKey: result.key.publicKey,
  };
}

test("Rekor lost acknowledgement exposes a nested 409 and fresh signing succeeds", async () => {
  const requests = [];
  const entries = new Map();
  let dropFirstResponse = true;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    requests.push({ method: request.method, path: request.url, body });
    const key = createHash("sha256").update(body).digest("hex");
    if (entries.has(key)) {
      response.writeHead(409, {
        "content-type": "application/json",
        location: `/api/v1/log/entries/${recordId}`,
      });
      response.end(JSON.stringify({ message: conflictText }));
      return;
    }
    entries.set(key, { [key]: { logIndex: entries.size, body: "" } });
    if (dropFirstResponse) {
      dropFirstResponse = false;
      response.destroy();
      return;
    }
    response.writeHead(201, { "content-type": "application/json" });
    response.end(JSON.stringify(entries.get(key)));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const client = new TLogClient({
      rekorBaseURL: `http://127.0.0.1:${server.address().port}`,
      retry: { retries: 1, minTimeout: 1, maxTimeout: 1 },
      timeout: 1000,
      fetchOnConflict: false,
    });
    const first = await signedEntry();
    await assert.rejects(client.createEntry(first.proposal), (error) => {
      assert.equal(error.code, "TLOG_CREATE_ENTRY_ERROR");
      assert.equal(error.message, `error creating tlog entry - (409) ${conflictText}`);
      assert.equal(error.cause.statusCode, 409);
      assert.equal(error.cause.location, `/api/v1/log/entries/${recordId}`);
      const formatted = getError(error, { npm: {}, command: null, pkg: null });
      assert.deepEqual(formatted.summary, [
        ["", `error creating tlog entry - (409) ${conflictText}`],
      ]);
      assert.deepEqual(formatted.detail, [["cause", `(409) ${conflictText}`]]);
      const json = jsonError(formatted, { loaded: true, config: { get: () => true } });
      assert.equal(json.code, "TLOG_CREATE_ENTRY_ERROR");
      assert.equal(json.summary, `error creating tlog entry - (409) ${conflictText}`);
      assert.equal(json.detail, `(409) ${conflictText}`);
      return true;
    });
    const second = await signedEntry();
    assert.notEqual(second.publicKey, first.publicKey);
    await client.createEntry(second.proposal);
    assert.deepEqual(
      requests.map(({ method }) => method),
      ["POST", "POST", "POST"],
    );
    assert.equal(new Set(requests.map(({ body }) => body)).size, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
