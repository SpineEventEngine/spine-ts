// Posts a domain-correct burst through the public Node client and reads the board projection.
import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { Client } from "@spine-event-engine/client-node";
import { AnyMessages, TypeUrls } from "@spine-event-engine/core";
import {
  BoardIdSchema,
  BoardMessageViewSchema,
  MessageIdSchema,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { PostMessageSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/commands_pb.js";
import { UserIdSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/user_pb.js";
import { ActorContextSchema } from "@spine-event-engine/proto";
import {
  CompositeFilter_CompositeOperator,
  CompositeFilterSchema,
  Filter_Operator,
  FilterSchema,
  QueryIdSchema,
  QuerySchema,
  TargetFiltersSchema,
  TargetSchema,
} from "@spine-event-engine/proto/client";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";

const baseUrl = process.env.MESSAGE_BOARD_BURST_URL;
const output = process.env.MESSAGE_BOARD_BURST_OUTPUT;
const count = Number(process.env.MESSAGE_BOARD_BURST_COUNT ?? "32");
if (baseUrl === undefined || output === undefined || !Number.isSafeInteger(count) || count < 1)
  throw new Error("Set MESSAGE_BOARD_BURST_URL, MESSAGE_BOARD_BURST_OUTPUT, and a positive count.");

const runId = randomUUID();
const board = "general";
const client = Client.connectTo(baseUrl);
const controller = new globalThis.AbortController();
const deadline = performance.now() + 45_000;
const postOutcomes = Array.from({ length: count }, (_, index) => ({
  messageId: `${runId}-${index}`,
  status: "pending",
}));
const result = { runId, baseUrl, count, status: "FAIL", postOutcomes };

async function bounded(promise, label, expiresAt = deadline) {
  const remaining = Math.max(1, Math.ceil(expiresAt - performance.now()));
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`${label} exceeded its deadline.`));
        }, remaining);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

await mkdir(resolve(output), { recursive: true });
let failure;
try {
  const actor = client.asGuest();
  const startedAt = Date.now();
  const outcomes = await bounded(
    Promise.all(
      Array.from({ length: count }, (_, index) =>
        actor
          .post(
            PostMessageSchema,
            create(PostMessageSchema, {
              id: create(MessageIdSchema, { value: postOutcomes[index].messageId }),
              board: create(BoardIdSchema, { value: board }),
              author: create(UserIdSchema, { value: `burst-${runId}` }),
              username: `Burst ${runId.slice(0, 8)}`,
              text: `burst message ${index} ${runId}`,
              postedAt: create(TimestampSchema, { seconds: BigInt(Math.floor(Date.now() / 1000)) }),
            }),
            { signal: controller.signal },
          )
          .then(
            (outcome) => ((postOutcomes[index].status = outcome.kind), outcome),
            (error) => ((postOutcomes[index].status = `error: ${String(error)}`), undefined),
          ),
      ),
    ),
    "concurrent posts",
  );
  if (outcomes.some((outcome) => outcome?.kind !== "ok"))
    throw new Error(
      `Only ${outcomes.filter((outcome) => outcome?.kind === "ok").length} of ${count} posts were acknowledged.`,
    );

  const query = create(QuerySchema, {
    id: create(QueryIdSchema, { value: `burst-${runId}` }),
    target: create(TargetSchema, {
      type: TypeUrls.derive(BoardMessageViewSchema),
      criterion: {
        case: "filters",
        value: create(TargetFiltersSchema, {
          filter: [
            create(CompositeFilterSchema, {
              operator: CompositeFilter_CompositeOperator.ALL,
              filter: [
                create(FilterSchema, {
                  fieldPath: { fieldName: ["board"] },
                  value: AnyMessages.pack(BoardIdSchema, create(BoardIdSchema, { value: board })),
                  operator: Filter_Operator.EQUAL,
                }),
              ],
            }),
          ],
        }),
      },
    }),
    context: create(ActorContextSchema),
  });
  const expected = new Set(Array.from({ length: count }, (_, index) => `${runId}-${index}`));
  Object.assign(result, {
    projected: 0,
    observedIds: [],
    duplicateIds: [],
    missingIds: [...expected],
  });
  let reads = 0;
  while (performance.now() < deadline) {
    const response = await bounded(actor.send(query, { signal: controller.signal }), "board query");
    reads += 1;
    const observed = response.message
      .flatMap((entry) => {
        if (entry.state === undefined) return [];
        const row = AnyMessages.unpack(entry.state, BoardMessageViewSchema);
        return row?.id?.value === undefined ? [] : [row.id.value];
      })
      .filter((id) => expected.has(id));
    const counts = new Map();
    for (const id of observed) counts.set(id, (counts.get(id) ?? 0) + 1);
    const duplicateIds = [...counts].filter(([, seen]) => seen !== 1).map(([id]) => id);
    const missingIds = [...expected].filter((id) => !counts.has(id));
    Object.assign(result, {
      reads,
      projected: observed.length,
      observedIds: observed,
      duplicateIds,
      missingIds,
    });
    if (duplicateIds.length > 0)
      throw new Error(`${duplicateIds.length} run-specific Message IDs appeared more than once.`);
    if (missingIds.length === 0) break;
    await bounded(delay(100, undefined, { signal: controller.signal }), "query polling delay");
  }
  if (result.missingIds?.length > 0)
    throw new Error(
      `${result.missingIds.length} projected messages were missing after ${reads} reads.`,
    );
  Object.assign(result, {
    status: "PASS",
    acknowledged: outcomes.filter((outcome) => outcome?.kind === "ok").length,
    reads,
    elapsedMs: Date.now() - startedAt,
  });
} catch (error) {
  Object.assign(result, { error: String(error) });
  failure = error;
} finally {
  controller.abort();
  result.acknowledged = postOutcomes.filter((item) => item.status === "ok").length;
  try {
    await bounded(client.close(), "client close", performance.now() + 3_000);
  } catch (error) {
    result.cleanupError = String(error);
    failure = failure === undefined ? error : new AggregateError([failure, error]);
  }
  if (failure !== undefined) result.status = "FAIL";
  await writeFile(resolve(output, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
}
if (failure !== undefined) throw failure;
