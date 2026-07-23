export interface DeliveryServerShutdownResources {
  readonly markNotServing: () => void;
  readonly closeAdmission: () => void;
  readonly closeAdmin: () => void;
  readonly closeNetwork: () => Promise<void>;
}

/** Runs the package-private terminal shutdown sequence in its required phase order. */
export async function runDeliveryServerShutdown(
  resources: DeliveryServerShutdownResources,
): Promise<void> {
  resources.markNotServing();
  resources.closeAdmission();
  resources.closeAdmin();
  await resources.closeNetwork();
}
