import { generateHandlerRegistry } from "@spine-event-engine/server/internal/handler-codegen";

/** Generates application handler registries. */
export const HandlerGeneration: Readonly<{ generate(applicationRoot: string): void }> =
  Object.freeze({
    /** Generates an application's conventional handler registry from its TypeScript project.
     *
     * @param applicationRoot The application package root.
     * @returns Nothing.
     */
    generate(applicationRoot: string): void {
      generateHandlerRegistry({ appRoot: applicationRoot });
    },
  });
