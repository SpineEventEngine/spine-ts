/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { create } from "@bufbuild/protobuf";
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import { DatastoreClient, type Datastore, type Query } from "@google-cloud/datastore";
import type { google } from "@google-cloud/datastore/build/protos/protos.js";
import { entity } from "@google-cloud/datastore/build/src/entity.js";
import { InboxMessageStatus } from "@spine-event-engine/proto/delivery";

/**
 * Data returned by a native inbox page, including its storage revision.
 */
type NativeMessage = google.datastore.v1.IEntityResult;

/**
 * Project and database selected by the supplied Datastore client.
 */
interface Destination {
  /**
   * Project receiving the request.
   */
  projectId: string;

  /**
   * Database selected inside the project.
   */
  databaseId?: string;
}

/**
 * Executes a native inbox operation within the factory lifetime.
 *
 * @typeParam T Operation result.
 * @param operation Inbox request to execute.
 * @returns The result of the request.
 */
type AdmitOperation = <T>(operation: () => Promise<T>) => Promise<T>;

/**
 * Uses the native client for inbox pages and acknowledgement. The higher-level
 * SDK omits the storage revision when it converts a query result to an entity.
 */
export class DatastoreInboxMutations {
  /**
   * Channel opened on the first native inbox operation.
   */
  #native: DatastoreClient | undefined;

  /**
   * Initializes the adapter with the factory's authentication, database and endpoint.
   *
   * @param datastore Client supplied by application configuration.
   * @param admit Keeps the factory open until an accepted operation completes.
   */
  constructor(
    private readonly datastore: Datastore,
    private readonly admit: AdmitOperation,
  ) {}

  /**
   * Returns one page with the revisions supplied by the same query.
   *
   * @param query Query with the shard filters, order, continuation and limit.
   * @returns Matching entities in delivery order.
   */
  page(query: Query): Promise<NativeMessage[]> {
    return this.admit(() => this.readPage(query));
  }

  /**
   * Reads native batches until the requested page is full.
   *
   * @param query Configured and limited shard query.
   * @returns Every message in this logical page.
   */
  private async readPage(query: Query): Promise<NativeMessage[]> {
    const destination = await this.destination();
    const partitionId = { ...destination, namespaceId: query.namespace ?? "" };
    const statement = entity.queryToQueryProto(query) as google.datastore.v1.IQuery;
    const messages: NativeMessage[] = [];
    let remaining = query.limitVal;
    while (remaining > 0) {
      const [reply] = await this.client().runQuery({
        ...destination,
        partitionId,
        query: statement,
      });
      const batch = reply.batch;
      if (!batch) throw new Error("Datastore inbox query returned no batch.");
      for (const message of batch.entityResults ?? []) messages.push(message);
      if (batch.moreResults !== "NOT_FINISHED") break;
      if (!batch.endCursor?.length || this.sameCursor(batch.endCursor, statement.startCursor))
        throw new Error("Datastore inbox page did not advance.");
      statement.startCursor = batch.endCursor;
      statement.offset = Math.max(0, (statement.offset ?? 0) - (batch.skippedResults ?? 0));
      remaining = query.limitVal - messages.length;
      statement.limit = { value: remaining };
    }
    return messages;
  }

  /**
   * Updates just the status and retention deadline of the given inbox ID.
   *
   * @param key Native inbox message key.
   * @param deadline Deadline computed by the framework's clock.
   * @param token Revision returned by the pending message's page.
   * @returns The first stored deadline or undefined when no pending message exists.
   */
  markDelivered(
    key: ReturnType<Datastore["key"]>,
    deadline: Timestamp,
    token?: unknown,
  ): Promise<Timestamp | undefined> {
    return this.admit(() => this.update(entity.keyToKeyProto(key), deadline, token));
  }

  /**
   * Applies acknowledgement to the current inbox ID and recovers the first deadline on a retry.
   *
   * @param key Physical inbox key.
   * @param deadline Proposed retention deadline.
   * @param token Revision returned by the ordinary delivery page.
   * @returns The first deadline when the message is delivered.
   */
  private async update(
    key: google.datastore.v1.IKey,
    deadline: Timestamp,
    token?: unknown,
  ): Promise<Timestamp | undefined> {
    const destination = await this.destination();
    let version = typeof token === "string" ? token : undefined;
    for (;;) {
      const conflict =
        version === undefined
          ? undefined
          : await this.complete(destination, key, version, deadline);
      if (version !== undefined && conflict === undefined) return deadline;
      const item = await this.metadata(destination, key);
      const properties = item?.entity?.properties;
      if (!properties) return undefined;
      const status: InboxMessageStatus = Number(properties.status?.integerValue);
      if (status === InboxMessageStatus.DELIVERED) {
        const until = properties.when_keep_until?.timestampValue;
        return until
          ? create(TimestampSchema, {
              seconds: BigInt((until.seconds ?? 0).toString()),
              nanos: until.nanos ?? 0,
            })
          : undefined;
      }
      if (status !== InboxMessageStatus.TO_DELIVER) return undefined;
      if (item.version == null) throw new Error("Datastore omitted the inbox message version.");
      const next = item.version.toString();
      if (conflict && next === version) throw conflict;
      version = next;
    }
  }

  /**
   * Closes the channel when the factory finishes using it.
   *
   * @returns Completion after the client shuts down.
   */
  async close(): Promise<void> {
    await this.#native?.close();
  }

  /**
   * Reads only the fields needed to resolve an acknowledgement retry or overwrite.
   *
   * @param destination Configured project and database.
   * @param key Physical inbox key.
   * @returns The current status, deadline and storage revision at that key.
   */
  private async metadata(
    destination: Destination,
    key: google.datastore.v1.IKey,
  ): Promise<NativeMessage | undefined> {
    for (;;) {
      const [reply] = await this.client().lookup({
        ...destination,
        keys: [key],
        propertyMask: { paths: ["status", "when_keep_until"] },
      });
      if (!reply.deferred?.length) return reply.found?.[0];
    }
  }

  /**
   * Marks one pending storage revision delivered in a single database call.
   *
   * @param destination Configured project and database.
   * @param key Physical inbox key.
   * @param version Pending revision supplied by the query or metadata read.
   * @param deadline First retention deadline for this inbox message.
   * @returns The conflict to resolve, or undefined when the update succeeded.
   */
  private async complete(
    destination: Destination,
    key: google.datastore.v1.IKey,
    version: string,
    deadline: Timestamp,
  ): Promise<Error | undefined> {
    try {
      const [response] = await this.client().commit({
        ...destination,
        mode: "NON_TRANSACTIONAL",
        mutations: [this.deliveryUpdate(key, version, deadline)],
      });
      const mutation = response.mutationResults?.[0];
      if (!mutation) throw new Error("Datastore did not return the inbox update result.");
      return mutation.conflictDetected
        ? new Error("Datastore inbox update conflicted with the stored version.")
        : undefined;
    } catch (error) {
      const code: unknown = error instanceof Error ? Reflect.get(error, "code") : undefined;
      if (error instanceof Error && (code === 5 || code === 9 || code === 10)) return error;
      throw error;
    }
  }

  /**
   * Returns the same project and database as ordinary inbox storage.
   *
   * @returns The identity used on native RPCs.
   */
  private async destination(): Promise<Destination> {
    const databaseId = this.datastore.options.databaseId;
    return {
      projectId: await this.datastore.getProjectId(),
      ...(databaseId ? { databaseId } : {}),
    };
  }

  /**
   * Opens a native channel on the first inbox operation that needs one.
   *
   * @returns The client shared by this factory's inbox handles.
   */
  private client(): DatastoreClient {
    return (this.#native ??= new DatastoreClient({ ...this.datastore.options }));
  }

  /**
   * Compares opaque Datastore continuation cursors as bytes.
   *
   * @param end Cursor returned by the latest batch.
   * @param start Cursor used to request that batch.
   * @returns Whether the database repeated the same position.
   */
  private sameCursor(end: string | Uint8Array, start?: string | Uint8Array | null): boolean {
    if (!start) return false;
    const bytes = (value: string | Uint8Array) =>
      typeof value === "string" ? Buffer.from(value, "base64") : Buffer.from(value);
    return bytes(end).equals(bytes(start));
  }

  /**
   * Updates the two materialized delivery properties using the revision read from storage.
   *
   * @param key Physical inbox key.
   * @param version Revision of the pending message.
   * @param deadline Retention deadline for the first successful acknowledgement.
   * @returns Native update preserving the signal payload.
   */
  private deliveryUpdate(
    key: google.datastore.v1.IKey,
    version: string,
    deadline: Timestamp,
  ): google.datastore.v1.IMutation {
    return {
      update: {
        key,
        properties: {
          status: { integerValue: InboxMessageStatus.DELIVERED },
          when_keep_until: {
            timestampValue: { seconds: String(deadline.seconds), nanos: deadline.nanos },
          },
        },
      },
      baseVersion: version,
      conflictResolutionStrategy: "FAIL",
      propertyMask: { paths: ["status", "when_keep_until"] },
    };
  }
}
