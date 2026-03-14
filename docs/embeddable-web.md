# Embeddable Web

This fork adds a browser-first surface for CodexMonitor without removing the upstream desktop app.

## What is embeddable

- The shared frontend source lives under `src/`
- The embeddable browser build is driven by `vite.embed.config.ts`
- The Bun bridge lives at `src/codexmonitor-web-backend.ts`
- The upstream daemon is still used as the backend runtime

The intended host shape is:

1. Start the daemon in a sandbox or VM.
2. Start the Bun bridge in the same runtime.
3. Serve the web app from Vercel or another web host.
4. Embed the app in an iframe with:
   - `?embed=1`
   - `?backendOrigin=https://<sandbox-host>`

Example:

```html
<iframe
  src="https://your-web-host.example/embed?embed=1&backendOrigin=https%3A%2F%2Fsandbox-host.example"
  style="width:100%;height:100%;border:0"
  allow="clipboard-read; clipboard-write"
></iframe>
```

## Runtime backend origin

The web app resolves its backend origin at runtime in this order:

1. `backendOrigin` query param
2. `window.__CODEXMONITOR_BACKEND_ORIGIN`
3. `VITE_CODEXMONITOR_BACKEND_ORIGIN`
4. dev fallback to `http://127.0.0.1:3000`

That makes per-session sandbox URLs practical without rebuilding the frontend.

## Embed mode

Embed mode is enabled when either:

- `?embed=1` is present, or
- the app is running inside an iframe

In embed mode the app:

- hides desktop window chrome
- posts `ready` and `resize` events to the parent window
- accepts simple host commands over `postMessage`

### Outgoing messages

```ts
{ source: "codexmonitor-web", type: "ready", embed: true, version: string }
{ source: "codexmonitor-web", type: "resize", height: number }
```

### Incoming messages

```ts
{ source: "codexmonitor-host", type: "ping" }
{ source: "codexmonitor-host", type: "focus-composer" }
{ source: "codexmonitor-host", type: "set-theme", theme: "light" | "dark" | "system" }
```
