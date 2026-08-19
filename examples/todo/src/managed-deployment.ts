/* Internal configuration for the To-Do managed executable. */
export interface TodoManagedDeployment {
  readonly host: string;
  readonly port: number;
  readonly projectId: string;
  readonly deliveryServerUrl: string;
  readonly processCount: number;
  readonly deliveryShardCount: number;
}

export function readTodoManagedDeployment(environment: NodeJS.ProcessEnv): TodoManagedDeployment {
  return {
    host: required(environment, "HOST"),
    port: port(required(environment, "PORT")),
    projectId: required(environment, "DATASTORE_PROJECT_ID"),
    deliveryServerUrl: httpUrl(required(environment, "DELIVERY_SERVER_URL")),
    processCount: positiveSafeInteger(required(environment, "PROCESS_COUNT"), "PROCESS_COUNT"),
    deliveryShardCount: positiveSafeInteger(
      required(environment, "DELIVERY_SHARD_COUNT"),
      "DELIVERY_SHARD_COUNT",
    ),
  };
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0)
    throw new Error(`Missing required configuration: ${name}.`);
  return value;
}
function port(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535)
    throw new Error("Invalid required configuration: PORT.");
  return parsed;
}
function positiveSafeInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`Invalid required configuration: ${name}.`);
  return parsed;
}
function httpUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("Invalid required configuration: DELIVERY_SERVER_URL.");
  return url.toString().replace(/\/$/u, "");
}
