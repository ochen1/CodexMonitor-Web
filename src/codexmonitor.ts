import { access, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { openSync } from "node:fs";

type JsonRpcRequest = {
  id: number;
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  id?: number;
  result?: unknown;
  error?: { message?: string };
  method?: string;
  params?: unknown;
};

const config = {
  repo: Bun.env.CODEXMONITOR_UPSTREAM_REPO ?? "https://github.com/Dimillian/CodexMonitor",
  ref: Bun.env.CODEXMONITOR_UPSTREAM_REF ?? "f4e31177214a2d83660a9c727be8494e90590ea6",
  vendorDir: path.resolve(Bun.env.CODEXMONITOR_VENDOR_DIR ?? "vendor/CodexMonitor"),
  dataDir: path.resolve(Bun.env.CODEXMONITOR_DATA_DIR ?? "data/codexmonitor"),
  listenAddr: Bun.env.CODEXMONITOR_LISTEN_ADDR ?? "127.0.0.1:4732",
  token: Bun.env.CODEXMONITOR_TOKEN?.trim() || "",
};

const daemonManifestPath = path.join(config.vendorDir, "src-tauri", "Cargo.toml");
const daemonDir = path.join(config.vendorDir, "src-tauri");
const daemonBinName = process.platform === "win32" ? "codex_monitor_daemon.exe" : "codex_monitor_daemon";
const daemonCtlBinName =
  process.platform === "win32" ? "codex_monitor_daemonctl.exe" : "codex_monitor_daemonctl";
const daemonBinPath = path.join(daemonDir, "target", "debug", daemonBinName);
const daemonCtlBinPath = path.join(daemonDir, "target", "debug", daemonCtlBinName);
const tokenPath = path.join(config.dataDir, "token.txt");
const pidPath = path.join(config.dataDir, "daemon.pid");
const logPath = path.join(config.dataDir, "daemon.log");

function usage(): string {
  return `Usage:
  bun run src/codexmonitor.ts prepare
  bun run src/codexmonitor.ts build
  bun run src/codexmonitor.ts daemon:start
  bun run src/codexmonitor.ts daemon:status
  bun run src/codexmonitor.ts daemon:stop
  bun run src/codexmonitor.ts workspace:add <absolute-or-relative-path>
  bun run src/codexmonitor.ts workspace:list
  bun run src/codexmonitor.ts ping
  bun run src/codexmonitor.ts token`;
}

async function run(args: string[], options: { cwd?: string; stdout?: "inherit" | "pipe"; stderr?: "inherit" | "pipe" } = {}) {
  const proc = Bun.spawn(args, {
    cwd: options.cwd,
    stdin: "inherit",
    stdout: options.stdout ?? "inherit",
    stderr: options.stderr ?? "inherit",
    env: process.env,
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode}): ${args.join(" ")}`);
  }

  return proc;
}

async function capture(args: string[], options: { cwd?: string } = {}): Promise<string> {
  const proc = Bun.spawn(args, {
    cwd: options.cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `Command failed (${exitCode}): ${args.join(" ")}`);
  }

  return stdout.trim();
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(targetPath: string): Promise<void> {
  await mkdir(targetPath, { recursive: true });
}

async function ensureToken(): Promise<string> {
  await ensureDir(config.dataDir);

  if (config.token) {
    return config.token;
  }

  if (await pathExists(tokenPath)) {
    return (await readFile(tokenPath, "utf8")).trim();
  }

  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  await writeFile(tokenPath, `${token}\n`, "utf8");
  return token;
}

function parseListenAddr(listenAddr: string): { host: string; port: number } {
  const [host, portRaw] = listenAddr.split(":");
  const port = Number.parseInt(portRaw ?? "", 10);
  if (!host || Number.isNaN(port)) {
    throw new Error(`Invalid CODEXMONITOR_LISTEN_ADDR: ${listenAddr}`);
  }

  return { host, port };
}

async function ensureUpstream(): Promise<void> {
  const parentDir = path.dirname(config.vendorDir);
  await ensureDir(parentDir);

  if (!(await pathExists(config.vendorDir))) {
    await run(["git", "clone", config.repo, config.vendorDir]);
    await run(["git", "-C", config.vendorDir, "fetch", "--tags", "origin"]);
    await run(["git", "-C", config.vendorDir, "checkout", config.ref]);
    return;
  }

  // Prefer the vendored checkout for local development. Reaching out to GitHub on
  // every daemon start makes the web port brittle when the network is unavailable.
  if (await pathExists(path.join(config.vendorDir, ".git"))) {
    try {
      await run(["git", "-C", config.vendorDir, "rev-parse", "--verify", config.ref]);
      await run(["git", "-C", config.vendorDir, "checkout", config.ref]);
      return;
    } catch {
      await run(["git", "-C", config.vendorDir, "fetch", "--tags", "origin"]);
      await run(["git", "-C", config.vendorDir, "checkout", config.ref]);
      return;
    }
  }

  if (!(await pathExists(daemonManifestPath))) {
    throw new Error(`Missing vendored CodexMonitor checkout at ${config.vendorDir}`);
  }
}

async function ensureCmake(): Promise<void> {
  try {
    await capture(["cmake", "--version"]);
  } catch {
    await run(["uv", "tool", "install", "cmake"]);
  }
}

async function ensureBuild(): Promise<void> {
  await ensureUpstream();
  await ensureCmake();

  if ((await pathExists(daemonBinPath)) && (await pathExists(daemonCtlBinPath))) {
    return;
  }

  await run([
    "cargo",
    "build",
    "--manifest-path",
    daemonManifestPath,
    "--bin",
    "codex_monitor_daemon",
    "--bin",
    "codex_monitor_daemonctl",
  ]);
}

async function rpcCall(method: string, params: unknown = {}): Promise<unknown> {
  const token = await ensureToken();
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

    socket.on("close", () => {
      if (!settled) {
        settled = true;
        reject(new Error("Daemon connection closed before response"));
      }
    });
  });
}

async function readPid(): Promise<number | null> {
  if (!(await pathExists(pidPath))) {
    return null;
  }

  const value = (await readFile(pidPath, "utf8")).trim();
  const pid = Number.parseInt(value, 10);
  return Number.isNaN(pid) ? null : pid;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function deletePidFile(): Promise<void> {
  await rm(pidPath, { force: true });
}

async function daemonInfo(): Promise<unknown> {
  return rpcCall("daemon_info", {});
}

async function daemonStatusObject(): Promise<{
  state: "running" | "stopped";
  pid: number | null;
  listenAddr: string;
  startedAtMs: number | null;
  lastError: string | null;
  info?: unknown;
}> {
  const pid = await readPid();

  try {
    const info = await daemonInfo();
    return {
      state: "running",
      pid,
      listenAddr: config.listenAddr,
      startedAtMs: null,
      lastError: null,
      info,
    };
  } catch (error) {
    if (pid && !isProcessAlive(pid)) {
      await deletePidFile();
    }

    const message = error instanceof Error ? error.message : String(error);
    const expectedStopped = !pid && message.includes("ECONNREFUSED");
    return {
      state: "stopped",
      pid: null,
      listenAddr: config.listenAddr,
      startedAtMs: null,
      lastError: expectedStopped ? null : message,
    };
  }
}

async function commandPrepare(): Promise<void> {
  await ensureUpstream();
  console.log(`Prepared ${config.vendorDir} at ${config.ref}`);
}

async function commandBuild(): Promise<void> {
  await ensureBuild();
  console.log(JSON.stringify({ daemonBinPath, daemonCtlBinPath }, null, 2));
}

async function commandDaemonStart(): Promise<void> {
  const existing = await daemonStatusObject();
  if (existing.state === "running") {
    console.log(JSON.stringify(existing, null, 2));
    return;
  }

  await ensureBuild();
  await ensureDir(config.dataDir);
  const token = await ensureToken();

  const stdoutFd = openSync(logPath, "a");
  const stderrFd = openSync(logPath, "a");
  const proc = Bun.spawn(
    ["./target/debug/codex_monitor_daemon", "--listen", config.listenAddr, "--data-dir", config.dataDir, "--token", token],
    {
      cwd: daemonDir,
      stdin: "ignore",
      stdout: stdoutFd,
      stderr: stderrFd,
      detached: true,
      env: process.env,
    }
  );
  proc.unref();
  await writeFile(pidPath, `${proc.pid}\n`, "utf8");

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await Bun.sleep(250);
    const status = await daemonStatusObject();
    if (status.state === "running") {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
  }

  throw new Error(`Daemon failed to start. Check ${logPath}`);
}

async function commandDaemonStatus(): Promise<void> {
  console.log(JSON.stringify(await daemonStatusObject(), null, 2));
}

async function commandDaemonStop(): Promise<void> {
  const pid = await readPid();

  try {
    await rpcCall("daemon_shutdown", {});
  } catch {
    // Fallback to pid-based termination below.
  }

  if (pid && isProcessAlive(pid)) {
    process.kill(pid, "SIGTERM");
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await Bun.sleep(250);
      if (!isProcessAlive(pid)) {
        break;
      }
    }
    if (isProcessAlive(pid)) {
      process.kill(pid, "SIGKILL");
    }
  }

  await deletePidFile();
  console.log(
    JSON.stringify(
      {
        state: "stopped",
        pid: null,
        listenAddr: config.listenAddr,
        startedAtMs: null,
        lastError: null,
      },
      null,
      2
    )
  );
}

async function commandWorkspaceAdd(workspacePathArg?: string): Promise<void> {
  if (!workspacePathArg) {
    throw new Error("workspace:add requires a path");
  }

  const workspacePath = path.resolve(workspacePathArg);
  const result = await rpcCall("add_workspace", { path: workspacePath });
  console.log(JSON.stringify(result, null, 2));
}

async function commandWorkspaceList(): Promise<void> {
  const result = await rpcCall("list_workspaces", {});
  console.log(JSON.stringify(result, null, 2));
}

async function commandPing(): Promise<void> {
  const result = await rpcCall("ping", {});
  console.log(JSON.stringify(result, null, 2));
}

async function commandToken(): Promise<void> {
  console.log(await ensureToken());
}

async function main(): Promise<void> {
  const [command, ...args] = Bun.argv.slice(2);

  switch (command) {
    case "prepare":
      await commandPrepare();
      return;
    case "build":
      await commandBuild();
      return;
    case "daemon:start":
      await commandDaemonStart();
      return;
    case "daemon:status":
      await commandDaemonStatus();
      return;
    case "daemon:stop":
      await commandDaemonStop();
      return;
    case "workspace:add":
      await commandWorkspaceAdd(args[0]);
      return;
    case "workspace:list":
      await commandWorkspaceList();
      return;
    case "ping":
      await commandPing();
      return;
    case "token":
      await commandToken();
      return;
    default:
      throw new Error(usage());
  }
}

await main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
