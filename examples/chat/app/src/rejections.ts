import type { MessageInitShape } from "@bufbuild/protobuf";
import { createRejectionThrowable, type RejectionThrowable } from "@spine-event-engine/core";

import { MessageAlreadyPostedSchema } from "@spine-event-engine/example-chat-model/generated/spine/example/chat/v1/rejections_pb.js";

/** Domain rejection raised when a client attempts to reuse a MessageId. */
export const MessageAlreadyPosted: {
  readonly create: (
    input: MessageInitShape<typeof MessageAlreadyPostedSchema>,
  ) => RejectionThrowable<typeof MessageAlreadyPostedSchema>;
} = Object.freeze({
  create: (input) => createRejectionThrowable(MessageAlreadyPostedSchema, input),
});
