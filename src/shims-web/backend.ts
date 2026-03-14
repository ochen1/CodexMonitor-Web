function configuredBackendOrigin(): string {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const queryOrigin = params.get("backendOrigin")?.trim();
    if (queryOrigin) {
      return queryOrigin.replace(/\/$/, "");
    }

    const globalOrigin = (
      window as typeof window & {
        __CODEXMONITOR_BACKEND_ORIGIN?: string;
      }
    ).__CODEXMONITOR_BACKEND_ORIGIN?.trim();
    if (globalOrigin) {
      return globalOrigin.replace(/\/$/, "");
    }
  }

  const envOrigin = (import.meta.env.VITE_CODEXMONITOR_BACKEND_ORIGIN as string | undefined)?.trim();
  if (envOrigin) {
    return envOrigin.replace(/\/$/, "");
  }

  if (typeof window !== "undefined" && window.location.port === "1420") {
    return "http://127.0.0.1:3000";
  }

  return "";
}

export function backendUrl(path: string): string {
  const origin = configuredBackendOrigin();
  return origin ? `${origin}${path}` : path;
}

export async function invokeBackend<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  const response = await fetch(backendUrl("/api/invoke"), {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ command, args: args ?? {} })
  });

  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? `Invoke failed: ${command}`);
  }

  return payload.result as T;
}
