import { rmSync } from "node:fs";

/**
 * Removes one temporary image-build directory on completion or process interruption.
 */
export class BuildContextCleanup {
  #directory;
  #runtime;
  #terminate;
  #handlers = new Map();
  #cleaned = false;

  /**
   * Creates cleanup ownership for one temporary directory.
   *
   * @param directory The temporary directory removed during cleanup.
   * @param runtime The process-like signal source that receives cleanup handlers.
   * @param terminate The operation that restores signal termination after cleanup.
   */
  constructor(
    directory,
    runtime = process,
    terminate = (signal) => process.kill(process.pid, signal),
  ) {
    this.#directory = directory;
    this.#runtime = runtime;
    this.#terminate = terminate;
  }

  /**
   * Registers cleanup for interrupt and termination signals.
   */
  install() {
    for (const signal of ["SIGINT", "SIGTERM"]) {
      const handler = () => {
        this.clean();
        this.uninstall();
        this.#terminate(signal);
      };
      this.#handlers.set(signal, handler);
      this.#runtime.once(signal, handler);
    }
  }

  /**
   * Removes every registered signal handler.
   */
  uninstall() {
    for (const [signal, handler] of this.#handlers) {
      this.#runtime.off(signal, handler);
    }
    this.#handlers.clear();
  }

  /**
   * Removes the temporary directory exactly once.
   */
  clean() {
    if (this.#cleaned) return;
    this.#cleaned = true;
    rmSync(this.#directory, { force: true, recursive: true });
  }
}
