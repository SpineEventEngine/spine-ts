import { Delivery } from "../delivery/delivery.js";
import type { InboxMessage } from "../delivery/inbox.js";
import type { ProjectionInbox, ProjectionInboxTarget } from "../repository/repository.js";
import {
  coordinateLocalInboxHandoff,
  drainLocalInboxMessage,
  localInboxHandoffKey,
} from "./local-inbox-handoff.js";

export class LocalProjectionInbox implements ProjectionInbox {
  readonly #contextName: string;
  readonly #targets = new Map<string, ProjectionInboxTarget>();
  readonly #inFlightHandoffs = new Map<string, Promise<InboxMessage>>();
  #nextVersion = 0n;

  constructor(contextName: string) {
    this.#contextName = contextName;
  }

  register(target: ProjectionInboxTarget): void {
    this.#targets.set(target.targetTypeUrl, target);
  }

  /** Replay one already-durable inbox row through registered projection targets. */
  replay(message: InboxMessage, deliveryTenantId?: string): Promise<void> {
    return this.#replay(message, deliveryTenantId);
  }

  async receive(
    delivery: Delivery,
    input: ProjectionInput,
    deliveryTenantId?: string,
  ): Promise<InboxMessage> {
    return await coordinateLocalInboxHandoff({
      handoffs: this.#inFlightHandoffs,
      key: localInboxHandoffKey(input, deliveryTenantId),
      onHandoff: () => this.#receiveAndDrain(delivery, input, deliveryTenantId),
    });
  }

  async #receiveAndDrain(
    delivery: Delivery,
    input: ProjectionInput,
    deliveryTenantId?: string,
  ): Promise<InboxMessage> {
    const written = await delivery.inbox.receive({
      inboxId: input.inboxId,
      signalId: input.signalId,
      label: input.label,
      status: input.status,
      shard: input.shard,
      whenReceived: new Date(),
      version: this.#takeVersion(),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.keepUntil === undefined ? {} : { keepUntil: input.keepUntil }),
    });

    await drainLocalInboxMessage({
      delivery,
      received: written.message,
      node: this.#contextName,
      onReplay: (message) => this.#replay(message, deliveryTenantId),
      replayFailureMessage: "Projection inbox replay failed.",
      skippedMessage: "Projection inbox delivery was skipped before the target row was delivered.",
      unfinishedMessage:
        "Projection inbox delivery did not reach the target row before the local drain finished.",
    });
    return written.message;
  }

  #takeVersion(): bigint {
    this.#nextVersion += 1n;
    return this.#nextVersion;
  }

  async #replay(message: InboxMessage, deliveryTenantId?: string): Promise<void> {
    assertProjectionMessage(message);

    const target = this.#targets.get(message.inboxId.targetTypeUrl);

    if (target === undefined) {
      throw new Error(
        `BoundedContext delivery has no projection subscriber target for "${message.inboxId.targetTypeUrl}".`,
      );
    }

    await target.replay(message, deliveryTenantId);
  }
}

type ProjectionInput = Parameters<ProjectionInbox["receive"]>[1];
type ProjectionMessage = Parameters<ProjectionInboxTarget["replay"]>[0];

function assertProjectionMessage(message: InboxMessage): asserts message is ProjectionMessage {
  if (message.label !== "UPDATE_SUBSCRIBER") {
    throw new Error(`BoundedContext delivery has no handler for inbox label "${message.label}".`);
  }
  if (message.status !== "TO_DELIVER") {
    throw new Error(
      `BoundedContext delivery cannot replay projection inbox message with status "${message.status}".`,
    );
  }
}
