/**
 * Minimal process surface used by the standalone To-Do listener.
 */
export interface TodoProcess {
  // prettier-ignore

  /**
   * Registers one signal listener.
   * @param signal Identifies the operating-system signal.
   * @param onSignal Handles the received signal.
   */
  once(signal: "SIGINT" | "SIGTERM", onSignal: () => void): void;

  /**
   * Selects the eventual process exit status.
   */
  exitCode: string | number | null | undefined;
}

/**
 * Registers one idempotent listener shutdown for the local To-Do process.
 *
 * @param server Supplies the listener that owns the local application resources.
 * @param processLike Supplies the Node process or a lifecycle test seam.
 */
export const TodoProcessSignals: Readonly<{
  install(server: Readonly<{ close(): Promise<void> }>, processLike?: TodoProcess): void;
}> = Object.freeze({
  install(server: Readonly<{ close(): Promise<void> }>, processLike: TodoProcess = process): void {
    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      void server.close().then(
        () => {
          processLike.exitCode = 0;
        },
        () => {
          processLike.exitCode = 1;
        },
      );
    };
    processLike.once("SIGINT", close);
    processLike.once("SIGTERM", close);
  },
});
