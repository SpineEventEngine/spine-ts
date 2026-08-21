import { create } from "@bufbuild/protobuf";
import { TypeUrls } from "@spine-event-engine/core";
import { SpineClientProvider, useEntityQuery } from "@spine-event-engine/client-react";
import { Client } from "@spine-event-engine/client-web";
import { BoardMessageViewSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { QueryIdSchema, QuerySchema, TargetSchema } from "@spine-event-engine/proto/client";
import { createElement } from "react";

const client = Client.forGrpcWeb("http://127.0.0.1:8080");
const request = client.onBehalfOf("alice");

const taskQuery = () =>
  create(QuerySchema, {
    id: create(QueryIdSchema, { value: "messages" }),
    target: create(TargetSchema, {
      type: TypeUrls.derive(BoardMessageViewSchema),
      criterion: { case: "includeAll", value: true },
    }),
  });

function Tasks() {
  const result = useEntityQuery(taskQuery, []);
  return createElement("output", undefined, result.status);
}

function App() {
  return createElement(SpineClientProvider, { request }, createElement(Tasks));
}

async function stopApplication() {
  await client.close();
}

void App;
void stopApplication;
