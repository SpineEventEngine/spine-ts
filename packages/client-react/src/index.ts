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
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

/** A result observed after a request is started by an effect. */
export type RequestObservation<Result> =
  | Readonly<{ readonly status: "idle" | "loading" }>
  | Readonly<{ readonly status: "success"; readonly value: Result }>
  | Readonly<{ readonly status: "error"; readonly error: unknown }>;

/** The current delivery and lifecycle state of one effect-owned subscription. */
export interface SubscriptionObservation {
  readonly status: "idle" | "connecting" | "connected" | "error";
  readonly delivery: SubscriptionDelivery | undefined;
  readonly lifecycle: SubscriptionLifecycle | undefined;
  readonly error: unknown;
}

/** Properties accepted by the client request provider. */
export interface SpineClientProviderProps {
  readonly request: ClientRequest;
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

/** Makes one application-owned client request scope available to descendant observers. */
export function SpineClientProvider({ request, children }: SpineClientProviderProps): ReactElement {
  return createElement(requestContext.Provider, { value: request }, children);
}

/** Returns the application-owned request scope supplied by {@link SpineClientProvider}. */
export function useSpineClient(): ClientRequest {
  const request = useContext(requestContext);
  if (request === undefined) throw new Error("A SpineClientProvider is required.");
  return request;
}

/**
 * Starts one asynchronous request after commit and observes only its live generation.
 * The factory must be stable for the supplied dependency list and forward the provided signal.
 * Cancellation is cooperative: a factory that ignores the signal may continue its underlying work.
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

/** Starts one raw Entity Query after commit using the provider request scope. */
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
 */
export function useEntitySubscription(
  topic: Parameters<ClientRequest["createSubscription"]>[0],
  authoritativeQuery: Extract<
    Parameters<ClientRequest["createSubscription"]>[1],
    { readonly kind: "entity" }
  >["authoritativeQuery"],
  dependencies: readonly unknown[],
): SubscriptionObservation {
  const request = useSpineClient();
  return useSubscription(
    () => request.createSubscription(topic, { kind: "entity", authoritativeQuery }),
    [request, ...dependencies],
  );
}

/**
 * Creates, activates, and observes an exposed-event subscription after commit.
 * Event gaps are published as lifecycle notices; they are not inferred as history.
 */
export function useEventSubscription(
  createSubscription: () => Promise<Subscription>,
  dependencies: readonly unknown[],
): SubscriptionObservation {
  return useSubscription(createSubscription, dependencies);
}

/** Returns the independently delivered lifecycle notification for a subscription observation. */
export function useSubscriptionLifecycle(
  observation: SubscriptionObservation,
): SubscriptionLifecycle | undefined {
  return observation.lifecycle;
}

/** Returns the most recently delivered entity/event update or authoritative entity recovery. */
export function useSubscriptionDelivery(
  observation: SubscriptionObservation,
): SubscriptionDelivery | undefined {
  return observation.delivery;
}

function useSubscription(
  createSubscription: () => Promise<Subscription>,
  dependencies: readonly unknown[],
): SubscriptionObservation {
  const [state, setState] = useState<SubscriptionObservation>(subscriptionIdle);
  const generation = useRef(0);
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

    publish({ status: "connecting", delivery: undefined, lifecycle: undefined, error: undefined });
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
        void observeDeliveries(handle, () => live, setState, cancel);
        void observeLifecycle(handle, () => live, setState, cancel);
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
}

async function observeDeliveries(
  subscription: Subscription,
  live: () => boolean,
  onSetState: (state: (previous: SubscriptionObservation) => SubscriptionObservation) => void,
  cancel: () => Promise<void>,
): Promise<void> {
  try {
    for await (const delivery of subscription.updates) {
      if (live()) onSetState((previous) => ({ ...previous, delivery }));
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
}

async function observeLifecycle(
  subscription: Subscription,
  live: () => boolean,
  onSetState: (state: (previous: SubscriptionObservation) => SubscriptionObservation) => void,
  cancel: () => Promise<void>,
): Promise<void> {
  try {
    for await (const lifecycle of subscription.lifecycle) {
      if (live()) onSetState((previous) => ({ ...previous, lifecycle }));
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
}
