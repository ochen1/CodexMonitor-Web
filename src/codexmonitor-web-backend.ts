import net from "node:net";
import path from "node:path";

type JsonRpcRequest = {
  id: number;
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  id?: number;
  result?: unknown;
  error?: { message?: string };
};

type JsonRpcNotification = {
  method?: string;
  params?: unknown;
};

const config = {
  port: Number.parseInt(Bun.env.PORT ?? "3000", 10),
  listenAddr: Bun.env.CODEXMONITOR_LISTEN_ADDR ?? "127.0.0.1:4732",
  tokenPath: path.resolve(Bun.env.CODEXMONITOR_DATA_DIR ?? "data/codexmonitor", "token.txt"),
  settingsPath: path.resolve(
    Bun.env.CODEXMONITOR_DATA_DIR ?? "data/codexmonitor",
    "web-settings.json",
  ),
};

const encoder = new TextEncoder();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

function parseListenAddr(listenAddr: string): { host: string; port: number } {
  const [host, portRaw] = listenAddr.split(":");
  const port = Number.parseInt(portRaw ?? "", 10);
  if (!host || Number.isNaN(port)) {
    throw new Error(`Invalid CODEXMONITOR_LISTEN_ADDR: ${listenAddr}`);
  }

  return { host, port };
}

async function getToken(): Promise<string> {
  const token = (await Bun.file(config.tokenPath).text()).trim();
  if (!token) {
    throw new Error(`Missing daemon token at ${config.tokenPath}`);
  }
  return token;
}

async function rpcCall(method: string, params: unknown = {}): Promise<unknown> {
  const token = await getToken();
  const { host, port } = parseListenAddr(config.listenAddr);

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let buffer = "";
    let stage: "auth" | "request" = "auth";
    const authId = 1;
    const requestId = 2;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.end();
      socket.destroy();
      fn();
    };

    const writeLine = (payload: JsonRpcRequest) => {
      socket.write(`${JSON.stringify(payload)}\n`);
    };

    const handleLine = (line: string) => {
      if (!line.trim()) {
        return;
      }

      const message = JSON.parse(line) as JsonRpcResponse;
      if (typeof message.id !== "number") {
        return;
      }

      if (stage === "auth" && message.id === authId) {
        if (message.error?.message) {
          finish(() => reject(new Error(message.error?.message ?? "Auth failed")));
          return;
        }
        stage = "request";
        writeLine({ id: requestId, method, params });
        return;
      }

      if (stage === "request" && message.id === requestId) {
        if (message.error?.message) {
          finish(() => reject(new Error(message.error?.message ?? `${method} failed`)));
          return;
        }
        finish(() => resolve(message.result));
      }
    };

    socket.setEncoding("utf8");
    socket.setTimeout(15_000);
    socket.on("connect", () => {
      writeLine({ id: authId, method: "auth", params: { token } });
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) {
          break;
        }
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        try {
          handleLine(line);
        } catch (error) {
          finish(() => reject(error));
          return;
        }
      }
    });
    socket.on("timeout", () => {
      finish(() => reject(new Error(`Timed out talking to daemon at ${config.listenAddr}`)));
    });
    socket.on("error", (error) => {
      finish(() => reject(error));
    });
  });
}

function sseChunk(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function embeddedRemoteTarget() {
  return {
    id: "embedded-web-backend",
    name: "Embedded web backend",
    provider: "tcp",
    host: config.listenAddr,
    token: null,
    lastConnectedAtMs: null,
  };
}

async function readStoredWebSettings(): Promise<JsonRecord> {
  const file = Bun.file(config.settingsPath);
  if (!(await file.exists())) {
    return {};
  }

  try {
    return asRecord(JSON.parse(await file.text()));
  } catch {
    return {};
  }
}

async function writeStoredWebSettings(settings: JsonRecord): Promise<void> {
  await Bun.write(config.settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

function normalizeWebAppSettings(value: unknown): JsonRecord {
  const settings = asRecord(value);
  const remoteTarget = embeddedRemoteTarget();
  const remoteBackends =
    Array.isArray(settings.remoteBackends) && settings.remoteBackends.length > 0
      ? settings.remoteBackends
      : [remoteTarget];
  const activeRemoteBackendId =
    typeof settings.activeRemoteBackendId === "string" &&
    settings.activeRemoteBackendId.trim().length > 0
      ? settings.activeRemoteBackendId
      : remoteTarget.id;

  return {
    ...settings,
    backendMode: "remote",
    remoteBackendProvider: "tcp",
    remoteBackendHost: config.listenAddr,
    remoteBackendToken: null,
    remoteBackends,
    activeRemoteBackendId,
  };
}

async function getEffectiveAppSettings(): Promise<JsonRecord> {
  let daemonSettings: JsonRecord = {};
  try {
    daemonSettings = asRecord(unwrapRpcPayload(await rpcCall("get_app_settings", {})));
  } catch {
    daemonSettings = {};
  }

  const storedSettings = await readStoredWebSettings();
  return normalizeWebAppSettings({
    ...daemonSettings,
    ...storedSettings,
  });
}

async function saveEffectiveAppSettings(settings: unknown): Promise<JsonRecord> {
  const normalized = normalizeWebAppSettings(
    asRecord(settings).settings ?? settings,
  );
  await writeStoredWebSettings(normalized);

  try {
    await rpcCall("update_app_settings", { settings: normalized });
  } catch {
    // Keep the browser override durable even if the daemon write fails.
  }

  return normalized;
}

async function openDaemonEventStream(handlers: {
  onEvent: (event: JsonRpcNotification) => void;
  onConnected: () => void;
  onError: (error: Error) => void;
  signal: AbortSignal;
}) {
  const token = await getToken();
  const { host, port } = parseListenAddr(config.listenAddr);
  const socket = net.createConnection({ host, port });
  let buffer = "";
  let authenticated = false;
  let closed = false;
  const authId = 1;

  const fail = (error: Error) => {
    if (closed) {
      return;
    }
    closed = true;
    handlers.onError(error);
    socket.destroy();
  };

  const cleanup = () => {
    if (closed) {
      return;
    }
    closed = true;
    socket.end();
    socket.destroy();
  };

  handlers.signal.addEventListener("abort", cleanup, { once: true });

  const writeLine = (payload: JsonRpcRequest) => {
    socket.write(`${JSON.stringify(payload)}\n`);
  };

  socket.setEncoding("utf8");
  socket.setTimeout(0);
  socket.on("connect", () => {
    writeLine({ id: authId, method: "auth", params: { token } });
  });
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }

      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }

      try {
        const message = JSON.parse(line) as JsonRpcResponse & JsonRpcNotification;
        if (typeof message.id === "number") {
          if (message.id === authId) {
            if (message.error?.message) {
              fail(new Error(message.error.message));
              return;
            }
            authenticated = true;
            handlers.onConnected();
          }
          continue;
        }

        if (!authenticated || typeof message.method !== "string") {
          continue;
        }

        handlers.onEvent({
          method: message.method,
          params: message.params ?? null,
        });
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
        return;
      }
    }
  });
  socket.on("error", (error) => {
    fail(error instanceof Error ? error : new Error(String(error)));
  });
  socket.on("close", () => {
    cleanup();
  });
}

function stubbedInvoke(command: string): unknown {
  switch (command) {
    case "get_codex_config_path":
      return "~/.codex/config.toml";
    case "get_agents_settings":
      return {
        configPath: "~/.codex/config.toml",
        multiAgentEnabled: false,
        maxThreads: 1,
        maxDepth: 1,
        agents: [],
      };
    case "file_read":
      return { exists: false, content: "", truncated: false };
    case "file_write":
    case "write_text_file":
    case "menu_set_accelerators":
    case "send_notification_fallback":
      return null;
    case "dictation_model_status":
      return { modelId: "base", state: "missing", progress: null, error: null };
    case "dictation_download_model":
    case "dictation_cancel_download":
    case "dictation_remove_model":
    case "dictation_start":
    case "dictation_stop":
    case "dictation_cancel":
      return null;
    case "dictation_request_permission":
      return false;
    case "tailscale_daemon_command_preview":
      return { command: "", daemonPath: "", listenAddr: config.listenAddr };
    case "tailscale_daemon_start":
    case "tailscale_daemon_stop":
    case "tailscale_daemon_status":
      return {
        state: "stopped",
        pid: null,
        startedAtMs: null,
        lastError: null,
        listenAddr: config.listenAddr,
      };
    case "local_usage_snapshot":
      return {
        serviceTiers: [],
        byModel: [],
        totals: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          totalCostUsd: 0,
        },
        windowStart: null,
        windowEnd: null,
      };
    case "terminal_open":
      return { terminalId: "web-terminal" };
    case "terminal_write":
    case "terminal_resize":
    case "terminal_close":
      return null;
    case "get_open_app_targets":
      return [];
    case "get_open_app_icon":
      return null;
    default:
      return null;
  }
}

function unwrapRpcPayload(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const isRpcEnvelope =
    "result" in record &&
    keys.every((key) =>
      key === "id" || key === "result" || key === "error" || key === "jsonrpc"
    );

  if (!isRpcEnvelope) {
    return value;
  }

  return unwrapRpcPayload(record.result);
}

const server = Bun.serve({
  port: config.port,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true, daemon: config.listenAddr });
    }

    if (url.pathname === "/api/events" && req.method === "GET") {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          let streamClosed = false;
          const close = () => {
            if (streamClosed) {
              return;
            }
            streamClosed = true;
            try {
              controller.close();
            } catch {
              // Stream already closed.
            }
          };

          void openDaemonEventStream({
            signal: req.signal,
            onConnected() {
              if (!streamClosed) {
                controller.enqueue(sseChunk("connected", { daemon: config.listenAddr }));
              }
            },
            onEvent(event) {
              if (!streamClosed) {
                controller.enqueue(sseChunk(event.method ?? "message", event.params ?? null));
              }
            },
            onError(error) {
              if (!streamClosed) {
                controller.enqueue(sseChunk("error", { message: error.message }));
              }
              close();
            },
          });

          req.signal.addEventListener("abort", close, { once: true });
        },
        cancel() {
          // Socket cleanup is handled via request abort.
        },
      });

      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          "connection": "keep-alive",
          "access-control-allow-origin": "*",
        },
      });
    }

    if (url.pathname === "/api/invoke" && req.method === "POST") {
      try {
        const body = (await req.json()) as { command?: string; args?: Record<string, unknown> };
        const command = body.command?.trim();
        if (!command) {
          return json({ error: "Missing command" }, 400);
        }

        if (command === "get_app_settings") {
          return json({ result: await getEffectiveAppSettings() });
        }

        if (command === "update_app_settings") {
          return json({ result: await saveEffectiveAppSettings(body.args ?? {}) });
        }

        try {
          const result = await rpcCall(command, body.args ?? {});
          return json({ result: unwrapRpcPayload(result) });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.toLowerCase().includes("unknown method") || message.toLowerCase().includes("not found")) {
            return json({ result: stubbedInvoke(command) });
          }

          if (message.includes("ECONNREFUSED")) {
            return json({ error: `CodexMonitor daemon is not running on ${config.listenAddr}` }, 503);
          }

          const fallback = stubbedInvoke(command);
          if (fallback !== null || command in { file_read: true, local_usage_snapshot: true }) {
            return json({ result: fallback });
          }
          return json({ error: message }, 500);
        }
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, 500);
      }
    }

    const distPath = path.resolve("embed-dist", url.pathname === "/" ? "index.html" : `.${url.pathname}`);
    const file = Bun.file(distPath);
    if (await file.exists()) {
      return new Response(file);
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`codexmonitor-web-backend listening on http://localhost:${server.port}`);
