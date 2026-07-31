import { TypeRegistry } from "@spine-event-engine/core";
import { messageBoardProtoModule as model0 } from "@spine-event-engine/example-message-board-model";

/** Registry of every model package declared by this application. */
export const typeRegistry: TypeRegistry = TypeRegistry.from(model0);
