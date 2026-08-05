import type {
  ClientRequest,
  Subscription,
  SubscriptionDelivery,
  SubscriptionLifecycle,
} from "@spine-event-engine/client-web";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

/**
 * A result observed after a request is started by an effect.
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
 * Receives each active Entity subscription delivery synchronously before React coalesces it.
 */
export type OnSubscriptionDelivery = (delivery: SubscriptionDelivery) => void;

/**
 * Receives each active Entity subscription lifecycle notice synchronously before React coalesces it.
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
 * @returns Returns the latest subscription observation.
 */
export function useEntitySubscription(
  topic: Parameters<ClientRequest["createSubscription"]>[0],
  authoritativeQuery: Extract<
    Parameters<ClientRequest["createSubscription"]>[1],
    { readonly kind: "entity" }
  >["authoritativeQuery"],
  dependencies: readonly unknown[],
  onDelivery?: OnSubscriptionDelivery,
  onLifecycle?: OnSubscriptionLifecycle,
): SubscriptionObservation {
  const request = useSpineClient();
  return SubscriptionObservers.use(
    () => request.createSubscription(topic, { kind: "entity", authoritativeQuery }),
    [request, ...dependencies],
    onDelivery,
    onLifecycle,
  );
}

/**
 * Creates, activates, and observes an exposed-event subscription after commit.
 * Event gaps are published as lifecycle notices; they are not inferred as history.
 * @param createSubscription Creates the event subscription.
 * @param dependencies Identifies when React must recreate the subscription.
 * @returns Returns the latest subscription observation.
 */
export function useEventSubscription(
  createSubscription: () => Promise<Subscription>,
  dependencies: readonly unknown[],
): SubscriptionObservation {
  return SubscriptionObservers.use(createSubscription, dependencies);
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
  use(
    createSubscription: () => Promise<Subscription>,
    dependencies: readonly unknown[],
    onDelivery?: OnSubscriptionDelivery,
    onLifecycle?: OnSubscriptionLifecycle,
  ): SubscriptionObservation {
    const [state, setState] = useState<SubscriptionObservation>(subscriptionIdle);
    const generation = useRef(0);
    const notifyDelivery = useEffectEvent((delivery: SubscriptionDelivery) => {
      onDelivery?.(delivery);
    });
    const notifyLifecycle = useEffectEvent((lifecycle: SubscriptionLifecycle) => {
      onLifecycle?.(lifecycle);
    });
    useEffect(() => {
      const current = ++generation.current;
      let live = true;
      let handle: Subscription | undefined;
      let cancelled: Promise<void> | undefined;
      const isLive = () => live;
      const cancel = () => {
        if (handle === undefined) return Promise.resolve();
        cancelled ??= Promise.resolve()
          .then(() => handle?.cancel())
          .catch(() => undefined);
        return cancelled;
      };
      const publish = (next: SubscriptionObservation) => {
        setState(next);
      };

      publish({
        status: "connecting",
        delivery: undefined,
        lifecycle: undefined,
        error: undefined,
      });
      void Promise.resolve()
        .then(() => (isLive() ? createSubscription() : undefined))
        .then(async (created) => {
          if (created === undefined) return;
          handle = created;
          if (!isLive()) {
            await cancel();
            return;
          }
          await handle.activate();
          if (!live) {
            await cancel();
            return;
          }
          publish({
            status: "connected",
            delivery: undefined,
            lifecycle: undefined,
            error: undefined,
          });
          void SubscriptionObservers.observeDeliveries(
            handle,
            () => live && generation.current === current && handle === created,
            setState,
            cancel,
            notifyDelivery,
          );
          void SubscriptionObservers.observeLifecycle(
            handle,
            () => live && generation.current === current && handle === created,
            setState,
            cancel,
            notifyLifecycle,
          );
        })
        .catch((error: unknown) => {
          if (live && generation.current === current) {
            setState({ status: "error", delivery: undefined, lifecycle: undefined, error });
            void cancel();
          }
        });
      return () => {
        live = false;
        void cancel();
      };
    }, dependencies);
    return state;
  },

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
