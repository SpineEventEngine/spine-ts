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

import type { DeliveryInbox } from "./delivery-ports.js";
import { InboxTargets, type InboxMessage } from "./inbox.js";

const recentDeliveryCapacity = 1_000;
const recentDeliveries = new WeakMap<DeliveryInbox, RecentDeliveries>();

/**
 * Applies the JVM delivery identity policy to raw Inbox pages.
 */
export class DeliveryDeduplication {
  readonly #recent: RecentDeliveries;

  /**
   * Creates duplicate tracking for one Inbox store.
   *
   * @param inbox The Inbox store whose recent deliveries are tracked.
   */
  constructor(inbox: DeliveryInbox) {
    const current = recentDeliveries.get(inbox);
    if (current !== undefined) {
      this.#recent = current;
    } else {
      this.#recent = new RecentDeliveries();
      recentDeliveries.set(inbox, this.#recent);
    }
  }

  /**
   * Creates the duplicate filter for one raw Inbox page.
   *
   * @param messages All statuses returned for the page.
   * @returns A page-local duplicate filter.
   */
  page(messages: readonly InboxMessage[]): DeliveryPageDeduplication {
    return new DeliveryPageDeduplication(messages, this.#recent);
  }

  /**
   * Records one successfully acknowledged delivery.
   *
   * @param message The acknowledged Inbox message.
   */
  recordDelivered(message: InboxMessage): void {
    this.#recent.add(message);
  }
}

class DeliveryPageDeduplication {
  readonly #identities: Set<string>;
  readonly #recent: RecentDeliveries;

  constructor(messages: readonly InboxMessage[], recent: RecentDeliveries) {
    this.#identities = new Set(
      messages
        .filter((message) => message.status === "DELIVERED")
        .map((message) => RecentDeliveries.key(message)),
    );
    this.#recent = recent;
  }

  /**
   * Reports whether a pending message duplicates this page or recent delivery,
   * and remembers a first occurrence for later rows in the same page.
   */
  isDuplicate(message: InboxMessage): boolean {
    const identity = RecentDeliveries.key(message);
    if (this.#identities.has(identity) || this.#recent.has(identity)) return true;
    this.#identities.add(identity);
    return false;
  }
}

class RecentDeliveries {
  readonly #identities = new Map<string, undefined>();

  has(identity: string): boolean {
    return this.#identities.has(identity);
  }

  add(message: InboxMessage): void {
    const identity = RecentDeliveries.key(message);
    this.#identities.delete(identity);
    this.#identities.set(identity, undefined);
    if (this.#identities.size > recentDeliveryCapacity) {
      const oldest = this.#identities.keys().next().value;
      if (oldest !== undefined) this.#identities.delete(oldest);
    }
  }

  static key(message: InboxMessage): string {
    return JSON.stringify([
      message.signalId,
      message.inboxId.targetTypeUrl,
      InboxTargets.key(message.inboxId.targetId),
    ]);
  }
}
