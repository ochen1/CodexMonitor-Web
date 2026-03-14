import { backendUrl } from "./backend";

export type Event<T = unknown> = {
  event: string;
  id: number;
  payload: T;
};

export type EventCallback<T = unknown> = (event: Event<T>) => void;
export type UnlistenFn = () => void;

const listeners = new Map<string, Set<EventCallback>>();
const eventSourceHandlers = new Map<string, EventListener>();
let source: EventSource | null = null;
let nextEventId = 1;

function debugState() {
  const target = window as typeof window & {
    __codexMonitorEventDebug?: Record<string, unknown>;
  };

  target.__codexMonitorEventDebug = {
    listenerCounts: Object.fromEntries(
      Array.from(listeners.entries()).map(([eventName, callbacks]) => [
        eventName,
        callbacks.size,
      ]),
    ),
    hasSource: Boolean(source),
    registeredHandlers: Array.from(eventSourceHandlers.keys()),
    nextEventId,
  };
}

function ensureSource() {
  if (source) {
    return source;
  }

  source = new EventSource(backendUrl("/api/events"));
  source.onerror = () => {
    // Native EventSource reconnect handles transient failures for us.
    debugState();
  };
  debugState();
  return source;
}

function maybeCloseSource() {
  if (listeners.size > 0 || !source) {
    return;
  }
  source.close();
  source = null;
  debugState();
}

export async function listen<T = unknown>(
  eventName: string,
  callback: EventCallback<T>,
): Promise<UnlistenFn> {
  const callbacks = listeners.get(eventName) ?? new Set<EventCallback>();
  callbacks.add(callback as EventCallback);
  listeners.set(eventName, callbacks);
  debugState();

  const es = ensureSource();
  if (!eventSourceHandlers.has(eventName)) {
    const handler: EventListener = ((rawEvent: MessageEvent<string>) => {
      let payload: unknown = null;
      try {
        payload = rawEvent.data ? JSON.parse(rawEvent.data) : null;
      } catch {
        payload = rawEvent.data;
      }

      const currentListeners = listeners.get(eventName);
      if (!currentListeners) {
        return;
      }

      const wrappedEvent: Event = {
        event: eventName,
        id: nextEventId++,
        payload,
      };
      debugState();
      for (const current of currentListeners) {
        current(wrappedEvent);
      }
    }) as EventListener;

    eventSourceHandlers.set(eventName, handler);
    es.addEventListener(eventName, handler);
    debugState();
  }

  return () => {
    const currentListeners = listeners.get(eventName);
    if (!currentListeners) {
      maybeCloseSource();
      return;
    }

    currentListeners.delete(callback as EventCallback);
    if (currentListeners.size === 0) {
      listeners.delete(eventName);
      const handler = eventSourceHandlers.get(eventName);
      if (handler && source) {
        source.removeEventListener(eventName, handler);
      }
      eventSourceHandlers.delete(eventName);
    }

    debugState();
    maybeCloseSource();
  };
}
