# Security

This project is intended to run a server-owned Codex daemon behind a Bun bridge.

## Reporting

If you find a security issue, do not open a public issue with exploit details.
Report it privately to the maintainer first.

## Deployment notes

- Do not expose the raw CodexMonitor daemon TCP port directly to browsers.
- Do not commit `.env`, daemon tokens, auth files, logs, or local state.
- Treat the Bun bridge as the only public-facing surface.
- Run the daemon with the minimum privileges required for the target workspace.
- Review any approval, shell execution, and file write settings before exposing the service to other users.
