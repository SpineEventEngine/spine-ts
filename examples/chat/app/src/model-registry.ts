import { TypeRegistry } from "@spine-event-engine/core";
import { chatProtoModule as model0 } from "@spine-event-engine/example-chat-model";

/** Registry of every model package declared by this application. */
export const typeRegistry: TypeRegistry = TypeRegistry.from(model0);
