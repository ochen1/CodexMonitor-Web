type HostToEmbedMessage =
  | { source: "codexmonitor-host"; type: "ping" }
  | { source: "codexmonitor-host"; type: "focus-composer" }
  | { source: "codexmonitor-host"; type: "set-theme"; theme: "light" | "dark" | "system" };

type EmbedToHostMessage =
  | { source: "codexmonitor-web"; type: "ready"; embed: true; version: string }
  | { source: "codexmonitor-web"; type: "resize"; height: number };

export function isEmbedMode(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const params = new URLSearchParams(window.location.search);
  return params.get("embed") === "1" || window.self !== window.top;
}

function postToHost(message: EmbedToHostMessage) {
  if (typeof window === "undefined" || window.parent === window) {
    return;
  }

  window.parent.postMessage(message, "*");
}

function focusComposer() {
  const textarea = document.querySelector<HTMLTextAreaElement>(".composer textarea");
  textarea?.focus();
}

export function bootEmbedBridge() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  if (!isEmbedMode()) {
    document.documentElement.dataset.embed = "false";
    return;
  }

  document.documentElement.dataset.embed = "true";

  const sendReady = () => {
    postToHost({
      source: "codexmonitor-web",
      type: "ready",
      embed: true,
      version: __APP_VERSION__,
    });
  };

  const root = document.getElementById("root");
  if (root && typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(([entry]) => {
      postToHost({
        source: "codexmonitor-web",
        type: "resize",
        height: Math.ceil(entry.contentRect.height),
      });
    });
    observer.observe(root);
  }

  window.addEventListener("message", (event: MessageEvent<HostToEmbedMessage>) => {
    const message = event.data;
    if (!message || message.source !== "codexmonitor-host") {
      return;
    }

    switch (message.type) {
      case "ping":
        sendReady();
        break;
      case "focus-composer":
        focusComposer();
        break;
      case "set-theme":
        document.documentElement.dataset.embedTheme = message.theme;
        break;
      default:
        break;
    }
  });

  window.addEventListener("load", sendReady, { once: true });
  queueMicrotask(sendReady);
}
