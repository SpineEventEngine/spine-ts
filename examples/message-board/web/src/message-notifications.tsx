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

import { useEffect, useState, type ReactElement } from "react";
import type {
  ClientRequest,
  Subscription,
  SubscriptionDelivery,
} from "@spine-event-engine/client-web";
import { AnyPacker } from "@spine-event-engine/core";
import { MessagePostedSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/events_pb.js";

/**
 * Renders permitted domain Event notifications separately from Entity state readers.
 *
 * @param props Selects the board and reader.
 * @returns The latest permitted notification and connection state.
 */
export const MessageNotifications = (props: {
  readonly board: string;
  readonly request: ClientRequest;
}): ReactElement => {
  const [message, setMessage] = useState<string>();
  const [disconnected, setDisconnected] = useState(false);
  useEffect(() => {
    const state: NotificationState = { active: true };
    setMessage(undefined);
    setDisconnected(false);
    void Notifications.observe(props, state, setMessage, setDisconnected);
    return () => {
      state.active = false;
      void state.subscription?.cancel().catch(() => undefined);
    };
  }, [props.board, props.request]);
  return (
    <section aria-label="Notifications">
      <h2>Latest notification</h2>
      {disconnected ? (
        <p role="alert">Live notifications are unavailable. Reload to reconnect.</p>
      ) : null}
      {message === undefined ? (
        <p>No notifications yet</p>
      ) : (
        <ul>
          <li>{message}</li>
        </ul>
      )}
    </section>
  );
};

/**
 * Active Event subscription tracked by the notification stream.
 */
interface NotificationState {
  active: boolean;
  subscription?: Subscription;
}

const Notifications = Object.freeze({
  /**
   * Streams permitted Event text until cancellation or a visible failure.
   *
   * @param props Selects the reader and board.
   * @param state Tracks cancellation and the active subscription.
   * @param onMessage Replaces the latest visible notification text.
   * @param onDisconnect Reports a failed or closed stream.
   * @returns Completion of the Event stream.
   */
  async observe(
    props: { readonly board: string; readonly request: ClientRequest },
    state: NotificationState,
    onMessage: (message: string) => void,
    onDisconnect: (value: boolean) => void,
  ): Promise<void> {
    try {
      const created = await props.request.createSubscription([MessagePostedSchema], {
        kind: "event",
      });
      state.subscription = created;
      if (!state.active) return;
      await created.activate();
      for await (const delivery of created.updates) {
        if (!state.active) return;
        Notifications.deliver(delivery, props.board, onMessage);
      }
      if (state.active) onDisconnect(true);
    } catch (error) {
      if (state.active) {
        console.warn("Message notifications disconnected.", error);
        onDisconnect(true);
      }
    } finally {
      await state.subscription?.cancel().catch(() => undefined);
    }
  },

  /**
   * Delivers only Events from the selected board as the latest notification.
   *
   * @param delivery Carries a streamed Event update.
   * @param board Selects the visible board.
   * @param onMessage Replaces the latest matching Event text.
   */
  deliver(
    delivery: SubscriptionDelivery,
    board: string,
    onMessage: (message: string) => void,
  ): void {
    if (delivery.kind !== "update" || delivery.update.update.case !== "eventUpdates") return;
    for (const item of delivery.update.update.value.event) {
      const event =
        item.message === undefined
          ? undefined
          : AnyPacker.tryUnpack(item.message, MessagePostedSchema);
      if (event?.board?.value === board) onMessage(event.text);
    }
  },
});
