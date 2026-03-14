# Vercel Sandbox Shape

This fork is intended to use Vercel for the user-facing web app and Vercel Sandbox for the per-session runtime.

## Recommended split

- Vercel project:
  - hosts the embed bundle produced by `bun run embed:build`
  - renders the product shell
  - creates sandbox sessions
- Vercel Sandbox:
  - runs `codex_monitor_daemon`
  - runs `src/codexmonitor-web-backend.ts`
  - exposes the Bun bridge port

## Why this split

- The frontend stays static and cacheable.
- Each user session can get its own isolated daemon runtime.
- The web app can target a session-specific backend origin through the `backendOrigin` query param.

## Sandbox startup

Inside the sandbox:

1. bootstrap CodexMonitor daemon binaries
2. start the daemon on `CODEXMONITOR_LISTEN_ADDR`
3. start the Bun bridge on `PORT`
4. expose `PORT` publicly or proxy it through your app backend

## Notes

- Prefer serving built assets, not the Vite dev server.
- Keep the raw daemon TCP port private; expose only the Bun bridge.
- If you need longer sessions, refresh or extend the sandbox timeout from the control plane.
