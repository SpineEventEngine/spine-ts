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

import type {
  ClientRequest,
  Subscription,
  SubscriptionDelivery,
  SubscriptionLifecycle,
  SubscriptionActivationOptions,
  EntitySubscriptionOptions,
} from "@spine-event-engine/client-web";
import type { Topic } from "@spine-event-engine/proto/client";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from "react";

/**
 * A result observed after a request is started by an effect.
 * @typeParam Result The successful request value.
 */
export type RequestObservation<Result> =
  | Readonly<{
      // prettier-ignore

      /**
       * Identifies an idle or loading request.
       */
      readonly status: "idle" | "loading";
    }>
  | Readonly<{
      // prettier-ignore

      /**
       * Identifies a successful request.
       */
      readonly status: "success";

      /**
       * Holds the request result.
       */
      readonly value: Result;
    }>
  | Readonly<{
      // prettier-ignore

      /**
       * Identifies a failed request.
       */
      readonly status: "error";

      /**
       * Holds the observed failure.
       */
      readonly error: unknown;
    }>;

/**
 * The current delivery and lifecycle state of one effect-owned subscription.
 */
export interface SubscriptionObservation {
  // prettier-ignore

  /**
   * Identifies the current subscription connection state.
   */
  readonly status: "idle" | "connecting" | "connected" | "error";

  /**
   * Holds the latest delivery, when one exists.
   */
  readonly delivery: SubscriptionDelivery | undefined;

  /**
   * Holds the latest lifecycle notice, when one exists.
   */
  readonly lifecycle: SubscriptionLifecycle | undefined;

  /**
   * Holds the latest observation error, when one exists.
   */
  readonly error: unknown;
}

/**
 * Delivers each active Entity subscription delivery synchronously before React coalesces it.
 *
 * @param delivery The delivery received from the active Entity subscription.
 */
export type OnSubscriptionDelivery = (delivery: SubscriptionDelivery) => void;

/**
 * Delivers each active Entity subscription lifecycle notice synchronously before React coalesces it.
 *
 * @param lifecycle The lifecycle notice received from the active Entity subscription.
 */
export type OnSubscriptionLifecycle = (lifecycle: SubscriptionLifecycle) => void;

/**
 * Properties accepted by the client request provider.
 */
export interface SpineClientProviderProps {
  // prettier-ignore

  /**
   * Supplies the application-owned client request scope.
   */
  readonly request: ClientRequest;

  /**
   * Supplies descendant React content.
   */
  readonly children?: ReactNode;
}

const requestContext = createContext<ClientRequest | undefined>(undefined);
const idle = Object.freeze({ status: "idle" } as const);
const subscriptionIdle = Object.freeze({
  status: "idle" as const,
  delivery: undefined,
  lifecycle: undefined,
  error: undefined,
});
const subscriptionConnecting = Object.freeze({
  ...subscriptionIdle,
  status: "connecting" as const,
});
const subscriptionConnected = Object.freeze({ ...subscriptionIdle, status: "connected" as const });

/**
 * Renders one application-owned client request scope for descendants.
 * @param props Supplies the application-owned request scope and descendant content.
 * @returns Returns the provider element.
 */
export function SpineClientProvider(props: SpineClientProviderProps): ReactElement {
  const { request, children } = props;
  return createElement(requestContext.Provider, { value: request }, children);
}

/**
 * Gets the application-owned request scope supplied by the provider.
 * @returns Returns the current request scope.
 */
export function useSpineClient(): ClientRequest {
  const request = useContext(requestContext);
  if (request === undefined) throw new Error("A SpineClientProvider is required.");
  return request;
}

/**
 * Starts one asynchronous request after commit and observes only its live generation.
 * The factory must be stable for the supplied dependency list and forward the provided signal.
 * Cancellation is cooperative: a factory that ignores the signal may continue its underlying work.
 * @typeParam Result The successful request value.
 * @param request Starts the asynchronous operation with an abort signal.
 * @param dependencies Identifies when React must start a new operation.
 * @returns Returns the latest request observation.
 */
export function useRequest<Result>(
  request: (signal: AbortSignal) => Promise<Result>,
  dependencies: readonly unknown[],
): RequestObservation<Result> {
  const [state, setState] = useState<RequestObservation<Result>>(idle);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setState({ status: "loading" });
    void Promise.resolve()
      .then(() => (live ? request(controller.signal) : undefined))
      .then(
        (value) => {
          if (live) setState({ status: "success", value: value as Result });
        },
        (error: unknown) => {
          if (live) setState({ status: "error", error });
        },
      );
    return () => {
      live = false;
      if (!controller.signal.aborted) controller.abort();
    };
  }, dependencies);
  return state;
}

/**
 * Starts one raw Entity Query after commit using the provider request scope.
 * @param query Creates the query sent by the effect.
 * @param dependencies Identifies when React must send the query again.
 * @returns Returns the latest query observation.
 */
export function useEntityQuery(
  query: () => Parameters<ClientRequest["send"]>[0],
  dependencies: readonly unknown[],
): RequestObservation<Awaited<ReturnType<ClientRequest["send"]>>> {
  const request = useSpineClient();
  return useRequest((signal) => request.send(query(), { signal }), [request, ...dependencies]);
}

/**
 * Creates, activates, and observes an entity subscription after commit.
 * The factory must call the public `createSubscription(topic, { kind: "entity", authoritativeQuery })`
 * contract, which performs the authoritative re-query after reconnect.
 * @param topic Supplies the subscription topic.
 * @param authoritativeQuery Creates the recovery query after reconnect.
 * @param dependencies Identifies when React must recreate the subscription.
 * @param onDelivery Optionally receives every delivery before React coalesces observation state.
 * @param onLifecycle Optionally receives every lifecycle notice before React coalesces observation state.
 * @param options Optional activation and first-update timing and notification.
 * @returns Returns the latest subscription observation.
 */
export function useEntitySubscription(
  topic: Topic,
  authoritativeQuery: EntitySubscriptionOptions["authoritativeQuery"],
  dependencies: readonly unknown[],
  onDelivery?: OnSubscriptionDelivery,
  onLifecycle?: OnSubscriptionLifecycle,
  options: EntityObservationOptions = {},
): SubscriptionObservation {
  const request = useSpineClient();
  const reactive = [
    request,
    ...dependencies,
    options.activationTimeoutMs,
    options.firstUpdateTimeoutMs,
    options.onFirstUpdateTimeout !== undefined,
  ];
  const timeoutCallback = SubscriptionObservers.useEntityTimeoutNotice(options, reactive);
  return SubscriptionObservers.use(
    SubscriptionObservers.entityFactory(
      request,
      topic,
      authoritativeQuery,
      options,
      timeoutCallback,
    ),
    reactive,
    onDelivery,
    onLifecycle,
    options.activationTimeoutMs === undefined
      ? {}
      : { activationTimeoutMs: options.activationTimeoutMs },
  );
}

interface EntityObservationOptions {
  readonly activationTimeoutMs?: number;
  readonly firstUpdateTimeoutMs?: number;
  readonly onFirstUpdateTimeout?: (subscription: Subscription) => void | Promise<void>;
}

/**
 * Creates, activates, and observes an exposed-event subscription after commit.
 * Event gaps are published as lifecycle notices; they are not inferred as history.
 * @param createSubscription Creates the event subscription.
 * @param dependencies Identifies when React must recreate the subscription.
 * @param onDelivery Optionally receives every delivery before React coalesces observation state.
 * @param onLifecycle Optionally receives every lifecycle notice before React coalesces observation state.
 * @param options Optional initial activation deadline.
 * @returns Returns the latest subscription observation.
 */
export function useEventSubscription(
  createSubscription: () => Promise<Subscription>,
  dependencies: readonly unknown[],
  onDelivery?: OnSubscriptionDelivery,
  onLifecycle?: OnSubscriptionLifecycle,
  options: Pick<SubscriptionActivationOptions, "activationTimeoutMs"> = {},
): SubscriptionObservation {
  return SubscriptionObservers.use(
    createSubscription,
    [...dependencies, options.activationTimeoutMs],
    onDelivery,
    onLifecycle,
    options,
  );
}

/**
 * Returns the independently delivered lifecycle notification for a subscription observation.
 * @param observation Supplies the subscription observation.
 * @returns Returns its latest lifecycle notification.
 */
export function useSubscriptionLifecycle(
  observation: SubscriptionObservation,
): SubscriptionLifecycle | undefined {
  return observation.lifecycle;
}

/**
 * Returns the most recently delivered entity/event update or authoritative entity recovery.
 * @param observation Supplies the subscription observation.
 * @returns Returns its latest delivery.
 */
export function useSubscriptionDelivery(
  observation: SubscriptionObservation,
): SubscriptionDelivery | undefined {
  return observation.delivery;
}

const SubscriptionObservers = Object.freeze({
  /**
   * Captures one committed Entity subscription factory.
   * @param request The public client.
   * @param topic The Entity topic.
   * @param authoritativeQuery Creates the recovery query.
   * @param options Configures first-update timing.
   * @param timeoutCallback Reads the current committed callback.
   * @returns A factory for the current render.
   */
  entityFactory(
    request: ClientRequest,
    topic: Topic,
    authoritativeQuery: EntitySubscriptionOptions["authoritativeQuery"],
    options: EntityObservationOptions,
    timeoutCallback: () => EntityObservationOptions["onFirstUpdateTimeout"],
  ): () => Promise<Subscription> {
    return () => {
      const onFirstUpdateTimeout = timeoutCallback();
      return request.createSubscription(topic, {
        kind: "entity",
        authoritativeQuery,
        ...(options.firstUpdateTimeoutMs === undefined
          ? {}
          : { firstUpdateTimeoutMs: options.firstUpdateTimeoutMs }),
        ...(onFirstUpdateTimeout === undefined ? {} : { onFirstUpdateTimeout }),
      });
    };
  },

  /**
   * Wraps committed callbacks without recreating a stream when their identities change.
   *
   * @param onDelivery The current delivery callback.
   * @param onLifecycle The current lifecycle callback.
   * @returns Stable callback wrappers for this render.
   */
  useNoticeCallbacks(onDelivery?: OnSubscriptionDelivery, onLifecycle?: OnSubscriptionLifecycle) {
    const delivery = useEffectEvent((notice: SubscriptionDelivery) => onDelivery?.(notice));
    const lifecycle = useEffectEvent((notice: SubscriptionLifecycle) => onLifecycle?.(notice));
    return { delivery, lifecycle };
  },

  /**
   * Binds first-update notices to the committed Entity subscription generation.
   * @param options The current timeout callback option.
   * @param dependencies Values that recreate the Entity subscription.
   * @returns A callback factory for the current generation.
   */
  useEntityTimeoutNotice(
    options: Readonly<{
      onFirstUpdateTimeout?: (subscription: Subscription) => void | Promise<void>;
    }>,
    dependencies: readonly unknown[],
  ): () => ((subscription: Subscription) => void | Promise<void>) | undefined {
    const generation = useRef(0);
    const notifyTimeout = useEffectEvent((subscription: Subscription) =>
      options.onFirstUpdateTimeout?.(subscription),
    );
    useLayoutEffect(() => {
      const current = ++generation.current;
      return () => {
        if (generation.current === current) generation.current++;
      };
    }, dependencies);
    return () => {
      if (options.onFirstUpdateTimeout === undefined) return undefined;
      const current = generation.current;
      return (subscription: Subscription) =>
        current === generation.current ? notifyTimeout(subscription) : undefined;
    };
  },

  /**
   * Creates one committed-generation subscription observer.
   * @param createSubscription Creates the public subscription handle.
   * @param dependencies Values that recreate the observation.
   * @param onDelivery Receives each consumed delivery.
   * @param onLifecycle Receives each lifecycle notice.
   * @param options The optional activation deadline.
   * @returns The latest observation state.
   */
  use(
    createSubscription: () => Promise<Subscription>,
    dependencies: readonly unknown[],
    onDelivery?: OnSubscriptionDelivery,
    onLifecycle?: OnSubscriptionLifecycle,
    options: Pick<SubscriptionActivationOptions, "activationTimeoutMs"> = {},
  ): SubscriptionObservation {
    const [state, setState] = useState<SubscriptionObservation>(subscriptionIdle);
    const generation = useRef(0);
    const callbacks = this.useNoticeCallbacks(onDelivery, onLifecycle);
    useLayoutEffect(() => {
      const current = ++generation.current;
      return () => {
        if (generation.current === current) generation.current += 1;
      };
    }, dependencies);
    useEffect(() => {
      const current = generation.current;
      const session = new ObservationSession(
        () => generation.current === current,
        setState,
        callbacks.delivery,
        callbacks.lifecycle,
      );
      void Promise.resolve().then(() => session.start(createSubscription, options));
      return () => {
        session.stop();
      };
    }, dependencies);
    return state;
  },

  /**
   * Publishes every delivery from the active subscription.
   * @param subscription The public handle.
   * @param live Checks whether this generation remains committed.
   * @param onSetState Updates React observation state.
   * @param cancel Cancels the handle after a stream failure.
   * @param onDelivery Receives each delivery before state coalescing.
   * @returns Completion after the update stream ends.
   */
  async observeDeliveries(
    subscription: Subscription,
    live: () => boolean,
    onSetState: (state: (previous: SubscriptionObservation) => SubscriptionObservation) => void,
    cancel: () => Promise<void>,
    onDelivery: OnSubscriptionDelivery,
  ): Promise<void> {
    try {
      for await (const delivery of subscription.updates) {
        if (live()) {
          onDelivery(delivery);
          onSetState((previous) => ({ ...previous, delivery }));
        }
      }
    } catch (error: unknown) {
      if (live())
        onSetState((previous) => ({
          ...previous,
          status: "error",
          error,
          lifecycle: previous.lifecycle,
        }));
      void cancel();
    }
  },

  /**
   * Publishes every lifecycle notice from the active subscription.
   * @param subscription The public handle.
   * @param live Checks whether this generation remains committed.
   * @param onSetState Updates React observation state.
   * @param cancel Cancels the handle after a stream failure.
   * @param onLifecycle Receives each lifecycle notice before state coalescing.
   * @returns Completion after the lifecycle stream ends.
   */
  async observeLifecycle(
    subscription: Subscription,
    live: () => boolean,
    onSetState: (state: (previous: SubscriptionObservation) => SubscriptionObservation) => void,
    cancel: () => Promise<void>,
    onLifecycle: OnSubscriptionLifecycle,
  ): Promise<void> {
    try {
      for await (const lifecycle of subscription.lifecycle) {
        if (live()) {
          onLifecycle(lifecycle);
          onSetState((previous) => ({ ...previous, lifecycle }));
        }
      }
    } catch (error: unknown) {
      if (live())
        onSetState((previous) => ({
          ...previous,
          status: "error",
          error,
          lifecycle: previous.lifecycle,
        }));
      void cancel();
    }
  },
});

/**
 * Coordinates one committed React subscription generation and its cleanup.
 */
class ObservationSession {
  #active = true;

  #handle: Subscription | undefined;

  #cancelled: Promise<void> | undefined;

  /**
   * Creates one observation session for a committed React generation.
   * @param isGenerationCurrent Checks the current React generation.
   * @param setState Publishes the latest observation.
   * @param onDelivery Receives each Event or Entity delivery.
   * @param onLifecycle Receives each lifecycle notice.
   */
  constructor(
    private readonly isGenerationCurrent: () => boolean,
    private readonly setState: Dispatch<SetStateAction<SubscriptionObservation>>,
    private readonly onDelivery: OnSubscriptionDelivery,
    private readonly onLifecycle: OnSubscriptionLifecycle,
  ) {}

  /**
   * Checks whether this subscription still belongs to the committed render.
   * @returns Whether updates may be published.
   */
  get live(): boolean {
    return this.#active && this.isGenerationCurrent();
  }

  /**
   * Checks whether this observation was retired before async work finished.
   *
   * @returns Whether the observation has been retired.
   */
  private hasRetired(): boolean {
    return !this.#active || !this.isGenerationCurrent();
  }

  /**
   * Creates and activates a subscription before consuming both streams.
   * @param createSubscription The public factory for this render.
   * @param options The activation deadline.
   * @returns Completion after observation starts or activation fails.
   */
  async start(
    createSubscription: () => Promise<Subscription>,
    options: Pick<SubscriptionActivationOptions, "activationTimeoutMs">,
  ): Promise<void> {
    this.setState(subscriptionConnecting);
    try {
      if (this.hasRetired()) return;
      const created = await createSubscription();
      this.#handle = created;
      if (this.hasRetired()) {
        await this.cancel();
        return;
      }
      await created.activate(options);
      if (this.hasRetired()) {
        await this.cancel();
        return;
      }
      this.setState(subscriptionConnected);
      this.observe(created);
    } catch (error) {
      if (this.live) {
        this.setState({ status: "error", delivery: undefined, lifecycle: undefined, error });
        void this.cancel();
      }
    }
  }

  /**
   * Starts both independently consumed delivery and lifecycle streams.
   * @param created The active subscription handle.
   */
  private observe(created: Subscription): void {
    const live = () => this.live && this.#handle === created;
    const cancel = () => this.cancel();
    void SubscriptionObservers.observeDeliveries(
      created,
      live,
      this.setState,
      cancel,
      this.onDelivery,
    );
    void SubscriptionObservers.observeLifecycle(
      created,
      live,
      this.setState,
      cancel,
      this.onLifecycle,
    );
  }

  /**
   * Stops this render and requests cancellation of its subscription.
   */
  stop(): void {
    this.#active = false;
    void this.cancel();
  }

  /**
   * Cancels the current handle at most once.
   * @returns Completion after cancellation settles.
   */
  cancel(): Promise<void> {
    if (this.#handle === undefined) return Promise.resolve();
    this.#cancelled ??= Promise.resolve()
      .then(() => this.#handle?.cancel())
      .then(
        () => undefined,
        () => undefined,
      );
    return this.#cancelled;
  }
}
