/** Reports an incompatible MySQL record-family schema without database details. */
export class MysqlStorageSchemaError extends Error {}

/** Reports stored record data that cannot be decoded without database details. */
export class MysqlStorageDataError extends Error {}

/** Reports a MySQL storage operation failure without database details. */
export class MysqlStorageOperationError extends Error {}

/** Converts an unknown failure to one public provider error without exposing driver details. */
export function mysqlError<E extends Error>(
  type: new (message: string) => E,
  message: string,
  error: unknown,
): E {
  return error instanceof MysqlStorageSchemaError ||
    error instanceof MysqlStorageDataError ||
    error instanceof MysqlStorageOperationError
    ? (error as E)
    : new type(message);
}
