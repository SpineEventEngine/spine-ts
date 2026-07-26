import { generateHandlerRegistry } from "@spine-event-engine/server/internal/handler-codegen";

/** Generates an application's conventional handler registry from its TypeScript project. */
export function generateHandlers(applicationRoot: string): void {
  generateHandlerRegistry({ appRoot: applicationRoot });
}
