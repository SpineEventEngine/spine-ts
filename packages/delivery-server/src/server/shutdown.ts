/** Describes the ordered resources closed during delivery-server shutdown. */
export interface DeliveryServerShutdownResources {
  /** Sets Health to no longer serving. */
  readonly markNotServing: () => void;
  /** Closes the shared mutation-admission boundary. */
  readonly closeAdmission: () => void;
  /** Closes Admin subscribers and publishing. */
  readonly closeAdmin: () => void;
  /** Closes the listener and active HTTP/2 sessions. */
  readonly closeNetwork: () => Promise<void>;
}

/** Provides the delivery-server terminal shutdown sequence. */
export const DeliveryShutdown: Readonly<{
  /**
   * Runs the required Health, admission, Admin, listener, and session shutdown order.
   *
   * @param resources Holds the shutdown resources in their required phases.
   * @returns A promise that resolves after network shutdown completes.
   */
  run: (resources: DeliveryServerShutdownResources) => Promise<void>;
}> = Object.freeze({
  run: async (resources: DeliveryServerShutdownResources): Promise<void> => {
    resources.markNotServing();
    resources.closeAdmission();
    resources.closeAdmin();
    await resources.closeNetwork();
  },
});
