export { DatastoreQueryLimitError } from "./datastore/record-storage.js";
export { DatastoreColumnMapping } from "./datastore/column-mapping.js";
export { DatastoreIdColumn } from "./datastore/id-column.js";
export { DefaultNamespaceConverter, type NamespaceConverter } from "./datastore/namespace.js";
export {
  DatastoreStorageFactory,
  type CreateEntityStorage,
  type CreateRecordStorage,
  type DatastoreEntityStorageHandle,
  type DatastoreStorageFactoryBuilder,
  type RecordLayout,
} from "./datastore/storage-factory.js";
