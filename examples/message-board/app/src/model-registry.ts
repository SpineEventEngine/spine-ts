import { TypeRegistry } from "@spine-event-engine/core";
import { messageBoardProtoModule as model0 } from "@spine-event-engine/example-message-board-model";

/**
 * The application type registry composed from every declared model package.
 */
export const typeRegistry: TypeRegistry = TypeRegistry.from(model0);
